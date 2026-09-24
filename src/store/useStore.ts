import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildSeedCards } from '../data/seed';
import { materializeBankEntry, pickDailyWords } from '../data/bank';
import { findDuplicate, normalizeEN, splitNewVsDuplicates } from '../lib/dedupe';
import { STORE_KEY, THEME_KEY } from '../lib/migrateLocal';
import { nextReviewForBox } from '../lib/srs';
import { supabase } from '../lib/supabase';
import type { Lang } from '../lib/i18n';
import { passwordIssue } from '../lib/password';
import {
  bankRowToCard,
  deleteCardRow,
  fetchAppSettings,
  fetchBankBatch,
  generateBankBatch,
  insertCardRows,
  loadWorkspace,
  syncProfileMeta,
  updateAppSettings,
  uploadPhoto,
  upsertCardRow,
  upsertStudyDay,
} from '../lib/cloud';
import type { Card, DayStat, Pile, Tab } from '../types';

/** Teto padrão do modo demonstração (sem login). Editável no painel admin. */
export const DEMO_MAX_DEFAULT = 100;

const DEMO_STASH_KEY = 'gringoles-demo-stash';

interface DemoStash {
  cards: Card[];
  xp: number;
  stats: DayStat[];
  dayStreak: number;
  bestStreak: number;
  lastStudyDate: string;
  lastAutoAddDate: string;
  lastAutoAddSlots?: Record<string, string>;
  newPerDay: number;
  autoNewPerDay: number;
  autoAddEnabled: boolean;
  autoAddTimes?: string[];
  demoMax: number;
  lang: Lang;
}

function stashDemo(s: Store): void {
  try {
    const stash: DemoStash = {
      cards: s.cards, xp: s.xp, stats: s.stats, dayStreak: s.dayStreak,
      bestStreak: s.bestStreak, lastStudyDate: s.lastStudyDate,
      lastAutoAddDate: s.lastAutoAddDate, lastAutoAddSlots: s.lastAutoAddSlots,
      newPerDay: s.newPerDay,
      autoNewPerDay: s.autoNewPerDay, autoAddEnabled: s.autoAddEnabled,
      autoAddTimes: s.autoAddTimes,
      demoMax: s.demoMax,
      lang: s.lang,
    };
    localStorage.setItem(DEMO_STASH_KEY, JSON.stringify(stash));
  } catch { /* noop */ }
}

function readStash(): DemoStash | null {
  try {
    const raw = localStorage.getItem(DEMO_STASH_KEY);
    return raw ? (JSON.parse(raw) as DemoStash) : null;
  } catch {
    return null;
  }
}

function passwordMsg(lang: Lang): string {
  return lang === 'en'
    ? 'Password needs 8+ characters with a letter and a number.'
    : 'A senha precisa de 8+ caracteres, com letra e número.';
}

function friendlyAuthError(msg: string, lang: Lang = 'pt'): string {
  const en = lang === 'en';
  if (/invalid login credentials/i.test(msg)) return en ? 'Invalid email or password.' : 'E-mail ou senha inválidos.';
  if (/user already registered/i.test(msg)) return en ? 'This email already has an account. Try logging in.' : 'Este e-mail já tem conta. Tente entrar.';
  if (/password should be|password.*characters|weak password/i.test(msg)) return passwordMsg(lang);
  if (/email.*confirm|email not confirmed/i.test(msg))
    return en ? 'This account needs a password reset — ask the admin.' : 'Esta conta precisa de liberação — fale com o admin.';
  if (/banned|blocked|banned_until/i.test(msg))
    return en ? '⛔ This account is blocked. Talk to the administrator.' : '⛔ Esta conta está bloqueada. Fale com o administrador.';
  return msg;
}

/** Idioma atual (para mensagens geradas no store). */
function L(): Lang {
  try {
    return useStore.getState().lang;
  } catch {
    return 'pt';
  }
}

/** Mensagem de erro de nuvem no idioma atual (frases prontas PT/EN). */
function cloudErr(ptMsg: string, enMsg: string, e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e);
  return L() === 'en' ? `⚠️ ${enMsg}: ${detail}` : `⚠️ ${ptMsg}: ${detail}`;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_AUTO_ADD_TIMES = ['08:00', '18:00'];

/** "HH:mm" <= horário atual? Compara em minutos locais. */
function slotDue(slot: string, now = new Date()): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot.trim());
  if (!m) return false;
  return Number(m[1]) * 60 + Number(m[2]) <= now.getHours() * 60 + now.getMinutes();
}

function normalizeTimesInput(v: string[]): string[] {
  const clean = v.map((x) => String(x).trim()).filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
  const uniq = [...new Set(clean)].sort();
  return uniq.length > 0 ? uniq.slice(0, 4) : [...DEFAULT_AUTO_ADD_TIMES];
}

/** Backoff exponencial da fila: 5s, 30s, 2min, 10min (teto). */
function backoffMs(attempts: number): number {
  const table = [5000, 30000, 120000, 600000];
  return table[Math.min(Math.max(0, attempts), table.length - 1)];
}

function bumpDayStat(stats: DayStat[], studiedDelta: number, knownDelta: number): DayStat[] {
  const key = todayKey();
  const found = stats.find((s) => s.date === key);
  if (found) {
    return stats.map((s) =>
      s.date === key
        ? { ...s, studied: s.studied + studiedDelta, known: s.known + knownDelta }
        : s,
    );
  }
  return [...stats, { date: key, studied: studiedDelta, known: knownDelta }].slice(-30);
}

interface Store {
  cards: Card[];
  theme: 'light' | 'dark';
  tab: Tab;
  pileFilter: Pile | 'all' | 'due';
  xp: number;
  bestStreak: number;
  dayStreak: number;
  lastStudyDate: string;
  stats: DayStat[];
  newPerDay: number;
  /** Palavras automáticas do banco por entrega (configurável, 2 entregas/dia). */
  autoNewPerDay: number;
  autoAddEnabled: boolean;
  /** Horários de entrega (HH:mm), ex: ["08:00","18:00"]. */
  autoAddTimes: string[];
  /** Última entrega por slot: { "08:00": "2026-09-24" }. */
  lastAutoAddSlots: Record<string, string>;
  lastAutoAddDate: string;
  /** Teto de palavras do modo demo (editável no admin). */
  demoMax: number;
  /** Motor de voz: 'proxy' (nuvem Google) ou 'piper' (neural offline). */
  ttsEngine: string;
  /** Vozes Piper (voiceId). */
  ttsVoiceEN: string;
  ttsVoicePT: string;
  /** Velocidade 0.5–1.5 (playbackRate). */
  ttsRate: number;
  /** Idioma da interface (imersão). */
  lang: Lang;

  setTab: (t: Tab) => void;
  setPileFilter: (f: Pile | 'all' | 'due') => void;
  toggleTheme: () => void;
  setNewPerDay: (n: number) => void;

  answer: (id: string, known: boolean) => void;
  movePile: (id: string, pile: Pile) => void;
  addCard: (
    c: Omit<Card, 'id' | 'pile' | 'box' | 'nextReviewAt' | 'correctStreak' | 'seenCount' | 'createdAt'> & Partial<Pick<Card, 'pile'>>,
    opts?: { allowDuplicate?: boolean },
  ) => { ok: true; card: Card } | { ok: false; reason: 'duplicate' | 'limit'; duplicate?: Card };
  updateCard: (id: string, patch: Partial<Card>) => void;
  removeCard: (id: string) => void;
  resetDemo: () => void;
  importCards: (cards: Card[]) => { added: number; skipped: number; limited: boolean };
  setAutoNewPerDay: (n: number) => void;
  setAutoAddEnabled: (v: boolean) => void;
  setAutoAddTimes: (v: string[]) => void;
  setTtsEngine: (v: string) => void;
  setTtsVoiceEN: (v: string) => void;
  setTtsVoicePT: (v: string) => void;
  setTtsRate: (n: number) => void;
  setDemoMax: (n: number) => void;
  setLang: (l: Lang) => void;
  /** Injeta as palavras do dia (demo local ou banco na nuvem). Retorna qtd adicionada. */
  ensureDailyWords: () => Promise<number>;
  /** Adianta agora o lote (útil p/ testar ou puxar extras). */
  topUpNow: () => Promise<number>;

  // ---------- sessão / nuvem ----------
  user: { id: string; email: string } | null;
  role: 'user' | 'admin';
  displayName: string;
  authLoading: boolean;
  authError: string | null;
  authNotice: string | null;
  showAuth: boolean;
  showInvite: boolean;
  inviteMsg: string;
  mustChangePassword: boolean;
  cloudNotice: string | null;
  setCloudNotice: (msg: string) => void;
  setShowAuth: (v: boolean) => void;
  setShowInvite: (v: boolean, msg?: string) => void;
  showTutorial: boolean;
  setShowTutorial: (v: boolean) => void;
  /** Fila de sincronização pendente (modo offline). Persistida — sobrevive reload. */
  outbox: { cards: string[]; deletes: string[]; meta: boolean; attempts: number; nextRetryAt: number };
  /** true durante flushOutbox (evita duplo flush). */
  syncing: boolean;
  /** Fotos (dataUrl) aguardando upload — cardId -> dataUrl. */
  pendingPhotos: Record<string, string>;
  /** Enfileira foto para tentar de novo no flush. */
  queuePhoto: (cardId: string, dataUrl: string) => void;
  /** Descarrega a fila na nuvem. force=true ignora o backoff. Retorna qtd sincronizada. */
  flushOutbox: (force?: boolean) => Promise<number>;
  clearCloudNotice: () => void;
  /** Restaura sessão do Supabase (se houver) e carrega o workspace da nuvem. */
  initAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Traz as palavras do demo (stash) para a conta. Retorna qtd importada. */
  migrateDemoToCloud: () => Promise<number>;
  changePassword: (password: string) => Promise<boolean>;
  /** Admin cadastra um usuário (nome/email/senha). Retorna ok + mensagem. */
  adminCreateUser: (email: string, password: string, displayName: string) => Promise<{ ok: boolean; msg: string }>;
  /** Admin bloqueia/desbloqueia/exclui um usuário. */
  manageUser: (action: 'block' | 'unblock' | 'delete', userId: string) => Promise<{ ok: boolean; msg: string }>;
}

const initialCards = () => buildSeedCards();

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      cards: initialCards(),
      theme: 'dark',
      tab: 'study',
      pileFilter: 'all',
      xp: 0,
      bestStreak: 0,
      dayStreak: 0,
      lastStudyDate: '',
      stats: [],
      newPerDay: 20,
      autoNewPerDay: 5,
      autoAddEnabled: true,
      autoAddTimes: [...DEFAULT_AUTO_ADD_TIMES],
      lastAutoAddSlots: {},
      lastAutoAddDate: '',
      ttsEngine: 'proxy',
      ttsVoiceEN: 'en_US-amy-medium',
      ttsVoicePT: 'pt_BR-faber-medium',
      ttsRate: 1,
      demoMax: DEMO_MAX_DEFAULT,
      lang: 'pt',

      user: null,
      role: 'user',
      displayName: '',
      authLoading: true,
      authError: null,
      authNotice: null,
      showAuth: false,
      showInvite: false,
      showTutorial: false,
      outbox: { cards: [], deletes: [], meta: false, attempts: 0, nextRetryAt: 0 },
      inviteMsg: '',
      mustChangePassword: false,
      cloudNotice: null,
      syncing: false,
      pendingPhotos: {},

      setTab: (tab) => set({ tab }),
      setPileFilter: (pileFilter) => set({ pileFilter }),
      toggleTheme: () =>
        set((s) => {
          const theme = s.theme === 'dark' ? 'light' : 'dark';
          try {
            document.documentElement.classList.toggle('dark', theme === 'dark');
            localStorage.setItem(THEME_KEY, theme);
          } catch { /* noop */ }
          return { theme };
        }),
      setNewPerDay: (newPerDay) => {
        set({ newPerDay });
        if (get().role === 'admin' && supabase) void updateAppSettings({ new_per_day: newPerDay }).catch(() => {});
      },

      answer: (id, known) => {
        set((s) => {
          const now = Date.now();
          const key = todayKey();
          const continued = s.lastStudyDate === key;
          // streak simples: +1 dia se estudou em dia diferente
          const lastDate = s.lastStudyDate;
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const dayStreak = continued ? s.dayStreak : lastDate === yesterday || lastDate === '' ? s.dayStreak + 1 : 1;

          const cards = s.cards.map((c) => {
            if (c.id !== id) return c;
            if (known) {
              const box = Math.min(5, c.box + 1);
              const pile: Pile = box >= 3 ? 'known' : c.pile === 'new' ? 'learning' : c.pile;
              return {
                ...c,
                box,
                pile,
                nextReviewAt: nextReviewForBox(box, now),
                correctStreak: c.correctStreak + 1,
                seenCount: c.seenCount + 1,
                lastSeenAt: now,
              };
            }
            return {
              ...c,
              box: 0,
              pile: 'learning' as Pile,
              nextReviewAt: now, // volta para fixar: revisa agora
              correctStreak: 0,
              seenCount: c.seenCount + 1,
              lastSeenAt: now,
            };
          });

          return {
            cards,
            xp: s.xp + (known ? 10 : 4),
            dayStreak,
            bestStreak: Math.max(s.bestStreak, dayStreak),
            lastStudyDate: key,
            stats: bumpDayStat(s.stats, 1, known ? 1 : 0),
          };
        });
        void syncCard(id);
        void syncProgress(1, known ? 1 : 0);
      },

      movePile: (id, pile) => {
        set((s) => ({
          cards: s.cards.map((c) =>
            c.id === id
              ? {
                  ...c,
                  pile,
                  box: pile === 'known' ? 5 : pile === 'new' ? 0 : 1,
                  nextReviewAt: pile === 'known' ? nextReviewForBox(5) : Date.now(),
                  lastSeenAt: Date.now(),
                }
              : c,
          ),
        }));
        void syncCard(id);
      },

      addCard: (c, opts?: { allowDuplicate?: boolean }) => {
        const s = get();
        if (!opts?.allowDuplicate) {
          const dup = findDuplicate(s.cards, c.en);
          if (dup) return { ok: false as const, reason: 'duplicate' as const, duplicate: dup };
        }
        if (!s.user && s.cards.length >= s.demoMax) {
          inviteLocked(s.cards.length);
          return { ok: false as const, reason: 'limit' as const };
        }
        const card: Card = {
          id: s.user && supabase ? crypto.randomUUID() : uid(),
          pile: 'new',
          box: 0,
          nextReviewAt: Date.now(),
          correctStreak: 0,
          seenCount: 0,
          createdAt: Date.now(),
          ...c,
        } as Card;
        set({ cards: [card, ...s.cards] });
        void syncCard(card.id);
        return { ok: true as const, card };
      },

      updateCard: (id, patch) => {
        set((s) => ({
          cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }));
        void syncCard(id);
      },

      removeCard: (id) => {
        const s = get();
        set({ cards: s.cards.filter((c) => c.id !== id) });
        if (s.user && supabase) {
          deleteCardRow(s.user.id, id).catch((e) => {
            enqueueOutbox({ deletes: [id] });
            get().setCloudNotice(cloudErr('Não apaguei na nuvem', 'Cloud delete failed', e));
          });
        }
      },

      resetDemo: () => {
        // No modo full o reset é papel do admin; aqui preserva a conta.
        if (get().user) return;
        set({
          cards: initialCards(),
          xp: 0,
          stats: [],
          dayStreak: 0,
          bestStreak: 0,
          lastStudyDate: '',
        });
      },

      importCards: (cards) => {
        const s = get();
        const { fresh, dups } = splitNewVsDuplicates(s.cards, cards);
        let limited = false;
        let batch = fresh;
        if (!s.user) {
          const room = Math.max(0, s.demoMax - s.cards.length);
          if (batch.length > room) {
            batch = batch.slice(0, room);
            limited = true;
            inviteLocked(s.cards.length);
          }
        }
        if (batch.length > 0) set({ cards: [...batch, ...s.cards] });
        if (s.user && supabase && batch.length > 0) void reloadCloudCards();
        return { added: batch.length, skipped: dups.length + (fresh.length - batch.length), limited };
      },

      setAutoNewPerDay: (autoNewPerDay) => {
        set({ autoNewPerDay });
        if (get().role === 'admin' && supabase) void updateAppSettings({ auto_new_per_day: autoNewPerDay }).catch(() => {});
      },
      setAutoAddEnabled: (autoAddEnabled) => {
        set({ autoAddEnabled });
        if (get().role === 'admin' && supabase) void updateAppSettings({ auto_add_enabled: autoAddEnabled }).catch(() => {});
      },
      setAutoAddTimes: (v) => {
        const times = normalizeTimesInput(v);
        set({ autoAddTimes: times });
        if (get().role === 'admin' && supabase) void updateAppSettings({ auto_add_times: times }).catch(() => {});
      },
      setTtsEngine: (v) => {
        const engine = v === 'piper' ? 'piper' : 'proxy';
        set({ ttsEngine: engine });
        if (get().role === 'admin' && supabase) void updateAppSettings({ tts_engine: engine }).catch(() => {});
      },
      setTtsVoiceEN: (ttsVoiceEN) => {
        set({ ttsVoiceEN });
        if (get().role === 'admin' && supabase) void updateAppSettings({ tts_voice_en: ttsVoiceEN }).catch(() => {});
      },
      setTtsVoicePT: (ttsVoicePT) => {
        set({ ttsVoicePT });
        if (get().role === 'admin' && supabase) void updateAppSettings({ tts_voice_pt: ttsVoicePT }).catch(() => {});
      },
      setTtsRate: (n) => {
        const ttsRate = Math.min(1.5, Math.max(0.5, Number(n) || 1));
        set({ ttsRate });
        if (get().role === 'admin' && supabase) void updateAppSettings({ tts_rate: ttsRate }).catch(() => {});
      },
      setDemoMax: (demoMax) => {
        const v = Math.max(1, demoMax);
        set({ demoMax: v });
        if (get().role === 'admin' && supabase) void updateAppSettings({ demo_max: v }).catch(() => {});
      },
      setLang: (lang) => {
        set({ lang });
        try {
          document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
        } catch { /* noop */ }
      },

      ensureDailyWords: async () => {
        const s = get();
        if (!s.autoAddEnabled || s.autoNewPerDay <= 0) return 0;
        const today = todayKey();
        const now = new Date();
        const times = normalizeTimesInput((s.autoAddTimes ?? []).length > 0 ? s.autoAddTimes ?? [] : [...DEFAULT_AUTO_ADD_TIMES]);
        // Migração silenciosa 1x/dia -> slots: se o formato antigo marcou hoje, considera todos entregues.
        let slots = { ...(s.lastAutoAddSlots ?? {}) };
        if (s.lastAutoAddDate === today && Object.keys(slots).length === 0) {
          slots = Object.fromEntries(times.map((t) => [t, today]));
          set({ lastAutoAddSlots: slots });
        }
        const due = times.filter((t) => slotDue(t, now) && slots[t] !== today);
        if (due.length === 0) return 0;
        let total = 0;
        const nextSlots = { ...slots };
        if (s.user && supabase) {
          try {
            const ownedEN = new Set(get().cards.map((c) => normalizeEN(c.en)));
            const ownedBankIds = new Set(get().cards.flatMap((c) => (c.bankId ? [c.bankId] : [])));
            for (const slot of due) {
              let batch = await fetchBankBatch(ownedEN, ownedBankIds, get().autoNewPerDay);
              if (batch.length === 0) {
                try {
                  batch = await generateBankBatch(get().autoNewPerDay);
                } catch { /* noop */ }
              }
              nextSlots[slot] = today;
              if (batch.length === 0) continue;
              const at = Date.now();
              const fresh = batch.map((row, i) => bankRowToCard(row, i, at + total + i));
              await insertCardRows(get().user!.id, fresh);
              for (const c of fresh) {
                ownedEN.add(normalizeEN(c.en));
                if (c.bankId) ownedBankIds.add(c.bankId);
              }
              total += fresh.length;
            }
            const ws = await loadWorkspace(get().user!.id);
            set({ cards: ws.cards, lastAutoAddSlots: nextSlots, lastAutoAddDate: today });
            return total;
          } catch (e) {
            get().setCloudNotice(cloudErr('Lote diário falhou', 'Daily batch failed', e));
            return 0;
          }
        }
        // ---- demo local (com teto) ----
        const room0 = Math.max(0, s.demoMax - s.cards.length);
        if (room0 <= 0) {
          inviteLocked(s.cards.length);
          set({ lastAutoAddSlots: nextSlots, lastAutoAddDate: today });
          return 0;
        }
        let pool = [...s.cards];
        const freshAll: Card[] = [];
        for (const slot of due) {
          const room = Math.max(0, s.demoMax - (pool.length + freshAll.length));
          if (room <= 0) {
            nextSlots[slot] = today;
            continue;
          }
          const picked = pickDailyWords([...pool, ...freshAll], Math.min(get().autoNewPerDay, room));
          const at = Date.now();
          const fresh = picked.map((e, i) => materializeBankEntry(e, i, at + total + i));
          freshAll.push(...fresh);
          total += fresh.length;
          nextSlots[slot] = today;
        }
        if (freshAll.length > 0) set({ cards: [...freshAll, ...get().cards] });
        set({ lastAutoAddSlots: nextSlots, lastAutoAddDate: today });
        if (total === 0 && Math.max(0, s.demoMax - s.cards.length) <= 0) inviteLocked(s.cards.length);
        return total;
      },

      topUpNow: async (): Promise<number> => {
        // Adianta 1 entrega agora, sem mexer nos slots já entregues (força o próximo pendente/futuro).
        const s = get();
        const today = todayKey();
        const times = normalizeTimesInput((s.autoAddTimes ?? []).length > 0 ? s.autoAddTimes ?? [] : [...DEFAULT_AUTO_ADD_TIMES]);
        const pending = times.find((t) => ((s.lastAutoAddSlots ?? {})[t] ?? '') !== today);
        const target = pending ?? times[times.length - 1];
        if (!target) return 0;
        // Marca os slots anteriores a hoje como entregues? Não — só garante que o target será processado.
        void target;
        const before = { ...(s.lastAutoAddSlots ?? {}) };
        // Força o target como pendente temporariamente
        const forced = { ...before };
        delete forced[target];
        set({ lastAutoAddSlots: forced });
        // Garante que o slot conta como vencido mesmo se o horário for futuro
        const origDue = slotDue(target, new Date());
        void origDue;
        // Chama a entrega forçando via bypass: injeta diretamente 1 lote
        const cur = get();
        if (!cur.autoAddEnabled || cur.autoNewPerDay <= 0) {
          set({ lastAutoAddSlots: before });
          return 0;
        }
        if (cur.user && supabase) {
          try {
            const ownedEN = new Set(cur.cards.map((c) => normalizeEN(c.en)));
            const ownedBankIds = new Set(cur.cards.flatMap((c) => (c.bankId ? [c.bankId] : [])));
            let batch = await fetchBankBatch(ownedEN, ownedBankIds, cur.autoNewPerDay);
            if (batch.length === 0) {
              try {
                batch = await generateBankBatch(cur.autoNewPerDay);
              } catch { /* noop */ }
            }
            set({ lastAutoAddSlots: { ...(get().lastAutoAddSlots ?? {}), [target]: today }, lastAutoAddDate: today });
            if (batch.length === 0) return 0;
            const at = Date.now();
            const fresh = batch.map((row, i) => bankRowToCard(row, i, at));
            await insertCardRows(cur.user.id, fresh);
            const ws = await loadWorkspace(cur.user.id);
            set({ cards: ws.cards });
            return fresh.length;
          } catch (e) {
            get().setCloudNotice(cloudErr('Lote diário falhou', 'Daily batch failed', e));
            return 0;
          }
        }
        const room = Math.max(0, cur.demoMax - cur.cards.length);
        if (room <= 0) {
          inviteLocked(cur.cards.length);
          set({ lastAutoAddSlots: { ...(get().lastAutoAddSlots ?? {}), [target]: today }, lastAutoAddDate: today });
          return 0;
        }
        const picked = pickDailyWords(cur.cards, Math.min(cur.autoNewPerDay, room));
        const at = Date.now();
        const fresh = picked.map((e, i) => materializeBankEntry(e, i, at));
        set({
          cards: [...fresh, ...get().cards],
          lastAutoAddSlots: { ...(get().lastAutoAddSlots ?? {}), [target]: today },
          lastAutoAddDate: today,
        });
        return fresh.length;
      },

      // ---------- sessão / nuvem ----------
      setShowAuth: (showAuth) => set({ showAuth, authError: null, authNotice: null }),
      setShowTutorial: (showTutorial) => set({ showTutorial }),

      queuePhoto: (cardId, dataUrl) =>
        set((s) => ({ pendingPhotos: { ...(s.pendingPhotos ?? {}), [cardId]: dataUrl } })),

      flushOutbox: async (force = false) => {
        const s = get();
        if (!s.user || !supabase) return 0;
        if (s.syncing) return 0;
        if (!force && (s.outbox.nextRetryAt ?? 0) > Date.now()) return 0;
        const cards = [...new Set(s.outbox.cards ?? [])];
        const deletes = [...new Set(s.outbox.deletes ?? [])];
        const meta = s.outbox.meta === true;
        const photos = { ...(s.pendingPhotos ?? {}) };
        const photoIds = Object.keys(photos);
        if (cards.length === 0 && deletes.length === 0 && !meta && photoIds.length === 0) return 0;
        set({ syncing: true });
        let done = 0;
        const failedCards: string[] = [];
        const failedDeletes: string[] = [];
        const failedPhotos: Record<string, string> = {};
        let metaOk = true;
        for (const id of deletes) {
          try {
            await deleteCardRow(s.user.id, id);
            done += 1;
          } catch {
            failedDeletes.push(id);
          }
        }
        // Fotos pendentes: tenta upload e grava photoUrl no card
        for (const cardId of photoIds) {
          try {
            const url = await uploadPhoto(s.user.id, photos[cardId]);
            const c = get().cards.find((k) => k.id === cardId);
            if (c) {
              const patched = { ...c, photoUrl: url, photo: undefined };
              useStore.setState((st) => ({
                cards: st.cards.map((k) => (k.id === cardId ? patched : k)),
              }));
              await upsertCardRow(s.user.id, patched);
            }
            done += 1;
          } catch {
            failedPhotos[cardId] = photos[cardId];
          }
        }
        for (const id of cards) {
          const c = get().cards.find((k) => k.id === id);
          if (!c) continue; // foi apagado depois — delete cobre
          try {
            await upsertCardRow(s.user.id, c);
            done += 1;
          } catch {
            failedCards.push(id);
          }
        }
        if (meta) {
          try {
            const cur = get();
            await syncProfileMeta(s.user.id, {
              xp: cur.xp, dayStreak: cur.dayStreak, bestStreak: cur.bestStreak, lastStudyDate: cur.lastStudyDate,
            });
            const today = new Date().toISOString().slice(0, 10);
            const day = cur.stats.find((d) => d.date === today);
            await upsertStudyDay(s.user.id, today, day?.studied ?? 0, day?.known ?? 0);
            done += 1;
          } catch {
            metaOk = false;
          }
        }
        const failed = failedCards.length + failedDeletes.length + Object.keys(failedPhotos).length > 0 || !metaOk;
        const attempts = failed ? (s.outbox.attempts ?? 0) + 1 : 0;
        set({
          syncing: false,
          pendingPhotos: failedPhotos,
          outbox: {
            cards: failedCards,
            deletes: failedDeletes,
            meta: meta ? !metaOk : false,
            attempts,
            nextRetryAt: failed ? Date.now() + backoffMs(attempts) : 0,
          },
        });
        if (failed) {
          get().setCloudNotice(L() === 'en' ? '⚠️ Some items are still pending sync. I’ll retry automatically.' : '⚠️ Alguns itens seguem pendentes. Vou tentar de novo sozinho.');
        } else if (done > 0) {
          set({ cloudNotice: null });
        }
        return done;
      },
      setShowInvite: (showInvite, inviteMsg) =>
        set((s) => ({ showInvite, inviteMsg: inviteMsg ?? s.inviteMsg })),
      clearCloudNotice: () => set({ cloudNotice: null }),
      setCloudNotice: (cloudNotice) => set({ cloudNotice }),

      initAuth: async () => {
        if (!supabase) {
          set({ authLoading: false });
          return;
        }
        // Settings globais primeiro (não bloqueia login se falhar/offline).
        try {
          const gs = await fetchAppSettings();
          if (gs) {
            set({
              newPerDay: gs.new_per_day,
              autoNewPerDay: gs.auto_new_per_day,
              autoAddEnabled: gs.auto_add_enabled,
              autoAddTimes: normalizeTimesInput(gs.auto_add_times),
              demoMax: Math.max(1, gs.demo_max),
              ttsEngine: gs.tts_engine === 'piper' ? 'piper' : 'proxy',
              ttsVoiceEN: gs.tts_voice_en || 'en_US-amy-medium',
              ttsVoicePT: gs.tts_voice_pt || 'pt_BR-faber-medium',
              ttsRate: Math.min(1.5, Math.max(0.5, Number(gs.tts_rate) || 1)),
            });
          }
        } catch { /* offline — mantém cache local */ }
        try {
          const { data } = await supabase.auth.getSession();
          const u = data.session?.user;
          if (u) await loadFull(u.id, u.email ?? '');
        } catch (e) {
          set({ authError: L() === 'en' ? `Could not restore session: ${msg(e)}` : `Falha ao restaurar sessão: ${msg(e)}` });
        } finally {
          set({ authLoading: false });
        }
      },

      signIn: async (email, password) => {
        if (!supabase) {
          set({ authError: 'Supabase não configurado.' });
          return false;
        }
        set({ authError: null, authNotice: null });
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error || !data.user) {
          set({ authError: friendlyAuthError(error?.message ?? 'login', get().lang) });
          return false;
        }
        const ok = await loadFull(data.user.id, data.user.email ?? email);
        if (!ok) return false;
        set({ showAuth: false });
        return true;
      },

      signUp: async (email, password, displayName) => {
        if (!supabase) {
          set({ authError: 'Supabase não configurado.' });
          return false;
        }
        set({ authError: null, authNotice: null });
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() || email.split('@')[0] } },
        });
        if (error) {
          set({ authError: friendlyAuthError(error.message, get().lang) });
          return false;
        }
        if (!data.session || !data.user) {
          // Confirmação de e-mail desligada no projeto — este ramo não deveria acontecer.
          set({ authNotice: get().lang === 'en' ? '✅ Account created! You can log in now.' : '✅ Conta criada! Você já pode entrar.' });
          return false;
        }
        const ok = await loadFull(data.user.id, data.user.email ?? email);
        if (!ok) return false;
        set({ showAuth: false });
        return true;
      },

      signOut: async () => {
        try {
          await supabase?.auth.signOut();
        } catch { /* noop */ }
        const stash = readStash();
        if (stash) {
          set({
            cards: stash.cards, xp: stash.xp, stats: stash.stats,
            dayStreak: stash.dayStreak, bestStreak: stash.bestStreak,
            lastStudyDate: stash.lastStudyDate, lastAutoAddDate: stash.lastAutoAddDate,
            lastAutoAddSlots: stash.lastAutoAddSlots ?? {},
            newPerDay: stash.newPerDay, autoNewPerDay: stash.autoNewPerDay,
            autoAddEnabled: stash.autoAddEnabled,
            autoAddTimes: normalizeTimesInput(stash.autoAddTimes ?? [...DEFAULT_AUTO_ADD_TIMES]),
            demoMax: stash.demoMax ?? DEMO_MAX_DEFAULT,
            lang: stash.lang || 'pt',
          });
        }
        set({ user: null, role: 'user', displayName: '', mustChangePassword: false, tab: 'study' });
      },

      migrateDemoToCloud: async () => {
        const s = get();
        if (!s.user || !supabase) return 0;
        const stash = readStash();
        const demoCards = (stash?.cards ?? []).filter((c) => c.en.trim() && c.pt.trim());
        if (demoCards.length === 0) return 0;
        try {
          const n = await insertCardRows(s.user.id, demoCards);
          const ws = await loadWorkspace(s.user.id);
          set({ cards: ws.cards });
          return n;
        } catch (e) {
          get().setCloudNotice(cloudErr('Migração falhou', 'Migration failed', e));
          return 0;
        }
      },

      adminCreateUser: async (email, password, displayName) => {
        if (!supabase) return { ok: false, msg: 'Supabase não configurado.' };
        const cleanEmail = email.trim();
        if (!/.+@.+\..+/.test(cleanEmail)) return { ok: false, msg: get().lang === 'en' ? 'Invalid email.' : 'E-mail inválido.' };
        if (passwordIssue(password)) return { ok: false, msg: passwordMsg(get().lang) };
        const name = displayName.trim() || cleanEmail.split('@')[0];
        // Caminho 1 (novo): Edge Function com service_role — não desloga o admin,
        // já cria com email_confirm=true + must_change_password=true.
        try {
          const { data, error } = await supabase.functions.invoke<{ ok: boolean; msg?: string }>('admin-create-user', {
            body: { email: cleanEmail, password, displayName: name },
          });
          if (!error && (data as { ok?: boolean })?.ok !== false) {
            return { ok: true, msg: `✅ ${cleanEmail} cadastrado! Ele entra com a senha inicial e troca no 1º acesso.` };
          }
          if (error && !/not found|Failed to fetch|404/i.test(String((error as Error)?.message ?? error))) {
            return { ok: false, msg: friendlyAuthError(String((error as Error)?.message ?? error), get().lang) };
          }
          // Edge ainda não deployada → cai para o legado abaixo.
        } catch { /* fallback legado */ }
        const adminEmail = get().user?.email ?? '';
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { display_name: name } },
        });
        if (error) return { ok: false, msg: friendlyAuthError(error.message, get().lang) };
        if (data.session && data.user) {
          // Projeto sem confirmação de e-mail: o signUp logou como o novo usuário.
          await supabase.auth.signOut();
          await get().signOut();
          try {
            await supabase.from('profiles').update({ must_change_password: true }).eq('id', data.user.id);
          } catch { /* noop */ }
          return {
            ok: true,
            msg: `✅ ${cleanEmail} cadastrado! Você saiu da sua conta — entre de novo como ${adminEmail}. Ele troca a senha no 1º acesso.`,
          };
        }
        return { ok: true, msg: `✅ ${cleanEmail} cadastrado! Ele já pode entrar e trocar a senha.` };
      },

      manageUser: async (action, userId) => {
        if (!supabase) return { ok: false, msg: 'Supabase não configurado.' };
        if (get().role !== 'admin') return { ok: false, msg: 'Acesso restrito.' };
        try {
          const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('admin-manage-user', {
            body: { action, userId },
          });
          if (error) return { ok: false, msg: friendlyAuthError(error.message, get().lang) };
          if (!(data as { ok?: boolean })?.ok) {
            return { ok: false, msg: friendlyAuthError(String((data as { error?: string })?.error ?? 'error'), get().lang) };
          }
          const en = get().lang === 'en';
          const msg = action === 'delete'
            ? (en ? '✅ User deleted.' : '✅ Usuário excluído.')
            : action === 'block'
              ? (en ? '⛔ User blocked.' : '⛔ Usuário bloqueado.')
              : (en ? '✅ User unblocked.' : '✅ Usuário desbloqueado.');
          return { ok: true, msg };
        } catch (e) {
          return { ok: false, msg: e instanceof Error ? e.message : String(e) };
        }
      },

      changePassword: async (password) => {
        if (!supabase) return false;
        if (passwordIssue(password)) {
          set({ authError: passwordMsg(get().lang) });
          return false;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          set({ authError: friendlyAuthError(error.message, get().lang) });
          return false;
        }
        try {
          const s = get();
          if (s.user) {
            await supabase.from('profiles').update({ must_change_password: false }).eq('id', s.user.id);
          }
        } catch { /* noop */ }
        set({ mustChangePassword: false, authError: null });
        return true;
      },
    }),
    {
      name: STORE_KEY,
      version: 3,
      migrate: (persisted: unknown) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const ob = (p.outbox ?? {}) as Record<string, unknown>;
        return {
          ...p,
          autoAddTimes: Array.isArray(p.autoAddTimes) && (p.autoAddTimes as unknown[]).length > 0
            ? p.autoAddTimes
            : [...DEFAULT_AUTO_ADD_TIMES],
          lastAutoAddSlots: (p.lastAutoAddSlots ?? {}) as Record<string, string>,
          lastAutoAddDate: (p.lastAutoAddDate ?? '') as string,
          pendingPhotos: (p.pendingPhotos ?? {}) as Record<string, string>,
          ttsEngine: p.ttsEngine === 'piper' ? 'piper' : 'proxy',
          ttsVoiceEN: (p.ttsVoiceEN as string) || 'en_US-amy-medium',
          ttsVoicePT: (p.ttsVoicePT as string) || 'pt_BR-faber-medium',
          ttsRate: Math.min(1.5, Math.max(0.5, Number(p.ttsRate) || 1)),
          outbox: {
            cards: (ob.cards ?? []) as string[],
            deletes: (ob.deletes ?? []) as string[],
            meta: (ob.meta ?? false) as boolean,
            attempts: (ob.attempts ?? 0) as number,
            nextRetryAt: (ob.nextRetryAt ?? 0) as number,
          },
        };
      },
      partialize: (s) => ({
        cards: s.cards,
        theme: s.theme,
        xp: s.xp,
        bestStreak: s.bestStreak,
        dayStreak: s.dayStreak,
        lastStudyDate: s.lastStudyDate,
        stats: s.stats,
        newPerDay: s.newPerDay,
        autoNewPerDay: s.autoNewPerDay,
        autoAddEnabled: s.autoAddEnabled,
        autoAddTimes: s.autoAddTimes,
        lastAutoAddSlots: s.lastAutoAddSlots,
        lastAutoAddDate: s.lastAutoAddDate,
        demoMax: s.demoMax,
        lang: s.lang,
        ttsEngine: s.ttsEngine,
        ttsVoiceEN: s.ttsVoiceEN,
        ttsVoicePT: s.ttsVoicePT,
        ttsRate: s.ttsRate,
        outbox: s.outbox,
        pendingPhotos: s.pendingPhotos,
      }),
    },
  ),
);

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Enfileira para sincronizar depois (offline). Reseta o backoff para tentar em breve. */
function enqueueOutbox(patch: Partial<{ cards: string[]; deletes: string[]; meta: boolean }>): void {
  const s = useStore.getState();
  useStore.setState({
    outbox: {
      cards: [...(s.outbox.cards ?? []), ...(patch.cards ?? [])],
      deletes: [...(s.outbox.deletes ?? []), ...(patch.deletes ?? [])],
      meta: s.outbox.meta === true || patch.meta === true,
      attempts: 0,
      nextRetryAt: 0,
    },
  });
  // Tenta descarregar em background (se online, sai na hora; se offline, falha e agenda backoff).
  void useStore.getState().flushOutbox(true).catch(() => {});
}

/** Sobe um card alterado para a nuvem (somente modo full; silencioso no demo). */
async function syncCard(id: string): Promise<void> {
  const s = useStore.getState();
  if (!s.user || !supabase) return;
  const c = s.cards.find((k) => k.id === id);
  if (!c) return;
  try {
    await upsertCardRow(s.user.id, c);
  } catch (e) {
    enqueueOutbox({ cards: [id] });
    useStore.getState().setCloudNotice(cloudErr('Não salvei na nuvem', 'Cloud save failed', e));
  }
}

/** Sobe XP/streak + dia com totais absolutos (idempotente — seguro repetir no flush). */
async function syncProgress(_studiedDelta: number, _knownDelta: number): Promise<void> {
  const s = useStore.getState();
  if (!s.user || !supabase) return;
  try {
    await syncProfileMeta(s.user.id, {
      xp: s.xp, dayStreak: s.dayStreak, bestStreak: s.bestStreak, lastStudyDate: s.lastStudyDate,
    });
    const today = new Date().toISOString().slice(0, 10);
    const day = s.stats.find((d) => d.date === today);
    await upsertStudyDay(s.user.id, today, day?.studied ?? 0, day?.known ?? 0);
  } catch (e) {
    enqueueOutbox({ meta: true });
    useStore.getState().setCloudNotice(cloudErr('Não salvei na nuvem', 'Cloud save failed', e));
  }
}

/** Recarrega os cards da nuvem (após import em lote, cujos ids são gerados no servidor). */
async function reloadCloudCards(): Promise<void> {
  const s = useStore.getState();
  if (!s.user || !supabase) return;
  try {
    const ws = await loadWorkspace(s.user.id);
    useStore.setState({ cards: ws.cards });
  } catch (e) {
    useStore.getState().setCloudNotice(cloudErr('Não recarreguei da nuvem', 'Cloud reload failed', e));
  }
}

/** Carrega workspace full: preserva o demo em stash e troca o conjunto de trabalho.
 * Retorna false se a conta estiver bloqueada (derruba a sessão). */
async function loadFull(userId: string, email: string): Promise<boolean> {
  const s = useStore.getState();
  if (!s.user) stashDemo(s);
  const ws = await loadWorkspace(userId);
  if (ws.isBlocked) {
    try {
      await supabase?.auth.signOut();
    } catch { /* noop */ }
    useStore.setState({
      user: null, role: 'user', displayName: '', mustChangePassword: false,
      authError: useStore.getState().lang === 'en'
        ? '⛔ This account is blocked. Talk to the administrator.'
        : '⛔ Esta conta está bloqueada. Fale com o administrador.',
      showAuth: true,
    });
    return false;
  }
  useStore.setState({
    cards: ws.cards,
    stats: ws.stats,
    xp: ws.xp,
    dayStreak: ws.dayStreak,
    bestStreak: ws.bestStreak,
    lastStudyDate: ws.lastStudyDate,
    user: { id: userId, email },
    role: ws.role,
    displayName: ws.displayName,
    mustChangePassword: ws.mustChangePassword,
    authError: null,
    tab: 'study',
  });
  return true;
}

function inviteLocked(count: number): void {
  const max = useStore.getState().demoMax;
  useStore.setState({
    showInvite: true,
    inviteMsg: `Você atingiu ${count} de ${max} palavras no modo demo 🎓 — solicite seu acesso para continuar com palavras ilimitadas. Seu progresso atual é migrado automaticamente.`,
  });
}

export function applyStoredTheme(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { theme?: string } };
      const theme = parsed?.state?.theme;
      document.documentElement.classList.toggle('dark', theme !== 'light');
      return;
    }
    const t = localStorage.getItem(THEME_KEY);
    document.documentElement.classList.toggle('dark', t !== 'light');
  } catch {
    /* noop */
  }
}
