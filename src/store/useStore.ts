import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildSeedCards } from '../data/seed';
import { materializeBankEntry, pickDailyWords } from '../data/bank';
import { findDuplicate, normalizeEN, splitNewVsDuplicates } from '../lib/dedupe';
import { STORE_KEY, THEME_KEY } from '../lib/migrateLocal';
import { nextReviewForBox, boxToPile, normalizePile } from '../lib/srs';
import { supabase } from '../lib/supabase';
import type { Lang } from '../lib/i18n';
import { passwordIssue } from '../lib/password';
import {
  bankRowToCard,
  deleteCardRow,
  enrichCardsWithBankTenses,
  fetchAppSettings,
  fetchBankBatch,
  generateBankBatch,
  insertCardRows,
  isUuidId,
  loadWorkspace,
  syncProfileMeta,
  updateAppSettings,
  uploadPhoto,
  upsertCardRow,
  upsertStudyDay,
} from '../lib/cloud';
import {
  ackOps,
  appendOp,
  backoffMs as journalBackoffMs,
  coalesceOps,
  getBackoff,
  legacyToOps,
  listOps,
  remapCardIdInOps,
  replaceOps,
  setBackoff,
} from '../lib/outbox';
import type { Card, DayStat, Pile, Tab } from '../types';

/** Teto padrão do modo demonstração (sem login). Editável no painel admin. */
export const DEMO_MAX_DEFAULT = 100;

const DEMO_STASH_KEY = 'gringoles-demo-stash';
/**
 * Proveniência do workspace em memória no STORE_KEY: 'demo' ou `full:<userId>`.
 * Sem ela, o boot com sessão expirada (ou app fechado logado) confunde os cards
 * full persistidos com demo — o stash guarda a nuvem como "demo" e o logout
 * restaura dados full no modo demo, estourando o teto. Demo e full nunca se misturam.
 */
const WORKSPACE_KEY = 'gringoles-workspace';

function workspaceMark(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? 'demo';
  } catch {
    return 'demo';
  }
}

function setWorkspaceMark(v: string): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, v);
  } catch { /* noop */ }
}

/** Aplica um DemoStash ao estado (logout / reset sem sessão). */
function applyDemoStash(stash: DemoStash): void {
  useStore.setState({
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

/** Demo zerada (seed) — fallback quando não há stash (ex: 1º login do aparelho). */
function applySeedDemo(): void {
  useStore.setState({
    cards: initialCards(),
    xp: 0,
    stats: [],
    dayStreak: 0,
    bestStreak: 0,
    lastStudyDate: '',
    lastAutoAddDate: '',
    lastAutoAddSlots: {},
  });
}

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

/**
 * Stash plausível? A demo genuína nunca supera o próprio teto (add/import/lote
 * impõem o limite) — se superou, o stash foi contaminado com dados full
 * (bug antigo) e deve ser descartado em favor da seed.
 */
function plausibleStash(stash: DemoStash | null): DemoStash | null {
  if (!stash || !Array.isArray(stash.cards)) return null;
  const cap = stash.demoMax ?? DEMO_MAX_DEFAULT;
  if (stash.cards.length > cap) return null;
  return stash;
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

/** Mensagens bilíngues do store (sem importar o dicionário — evita ciclo). */
function noDbMsg(): string {
  return L() === 'en' ? 'Supabase not configured.' : 'Supabase não configurado.';
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

/** Backoff exponencial da fila: 5s, 30s, 2min, 10min (teto). Delegado ao journal. */
function backoffMs(attempts: number): number {
  return journalBackoffMs(attempts);
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

/** userId da fila v2 (null = demo local). Journal é por conta — demo nunca vaza p/ full. */
function journalKey(): string | null {
  try {
    return useStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

/** Espelha o tamanho do journal no estado (p/ UI reativa) sem guardar payload no persist. */
function refreshPendingMirror(): void {
  try {
    const n = listOps(journalKey()).length;
    const cur = useStore.getState().pendingCount;
    if (cur !== n) useStore.setState({ pendingCount: n });
  } catch { /* noop */ }
}

/**
 * Garante id uuid válido p/ nuvem. Cards vindos do demo/import (seed-…, csv-…,
 * uid()) quebram o upsert no Postgres PARA SEMPRE (invalid input syntax for
 * type uuid) — essa era a causa do banner de pendência que nunca sumia.
 * Remapeia o id local 1x (estado + ops de foto) e devolve o card vigente.
 */
function ensureCloudCardId(id: string): Card | null {
  const s = useStore.getState();
  const c = s.cards.find((k) => k.id === id);
  if (!c) return null;
  if (isUuidId(c.id)) return c;
  let fresh: string;
  try {
    fresh = crypto.randomUUID();
  } catch {
    fresh = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const patched = { ...c, id: fresh };
  useStore.setState((st) => ({
    cards: st.cards.map((k) => (k.id === id ? patched : k)),
  }));
  try {
    remapCardIdInOps(s.user?.id ?? null, id, fresh);
  } catch { /* noop */ }
  return patched;
}

export interface AdminUserRow {
  id: string;
  email?: string;
  created_at?: string;
  profile: {
    id: string;
    display_name: string | null;
    role: string;
    xp: number;
    created_at: string;
    is_blocked: boolean;
    must_change_password?: boolean;
  } | null;
}

interface Store {
  cards: Card[];
  theme: 'light' | 'dark';
  tab: Tab;
  pileFilter: Pile | 'all';
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
  /** Idioma da interface (imersão). */
  lang: Lang;

  setTab: (t: Tab) => void;
  setPileFilter: (f: Pile | 'all') => void;
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
  showProfile: boolean;
  setShowProfile: (v: boolean) => void;
  updateDisplayName: (name: string) => Promise<{ ok: boolean; msg: string }>;
  /** Admin lista usuários com e-mail (via Edge admin-manage-user action=list). */
  adminListUsers: () => Promise<{ ok: boolean; msg: string; users: AdminUserRow[] }>;
  /** Admin define nova senha inicial (força troca no 1º acesso). */
  adminResetPassword: (userId: string, password: string) => Promise<{ ok: boolean; msg: string }>;
  /** Fila de sincronização pendente (modo offline). Persistida — sobrevive reload. */
  outbox: { cards: string[]; deletes: string[]; meta: boolean; attempts: number; nextRetryAt: number };
  /** true durante flushOutbox (evita duplo flush). */
  syncing: boolean;
  /** Fotos (dataUrl) aguardando upload — cardId -> dataUrl. */
  pendingPhotos: Record<string, string>;
  /** Contador derivado do journal v2 (fonte de verdade p/ UI). */
  pendingCount: number;
  /** Recalcula pendingCount a partir do journal (por usuário). */
  refreshPending: () => void;
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
      pileFilter: 'new',
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
      showProfile: false,
      setShowProfile: (showProfile) => set({ showProfile }),
      outbox: { cards: [], deletes: [], meta: false, attempts: 0, nextRetryAt: 0 },
      inviteMsg: '',
      mustChangePassword: false,
      cloudNotice: null,
      syncing: false,
      pendingPhotos: {},
      pendingCount: 0,
      refreshPending: () => refreshPendingMirror(),

      // Abrir/voltar para Estudar sempre seleciona a 1ª caixa (Novas).
      setTab: (tab) => set((s) => (tab === 'study' && s.tab !== 'study' ? { tab, pileFilter: 'new' } : { tab })),
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

      // SRS 5 caixas: ✅ avança +1, ❌ volta −1. Em Novas, ❌ mantém lá (só marca vista).
      answer: (id, known) => {
        set((s) => {
          const now = Date.now();
          const key = todayKey();
          const continued = s.lastStudyDate === key;
          const lastDate = s.lastStudyDate;
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const dayStreak = continued ? s.dayStreak : lastDate === yesterday || lastDate === '' ? s.dayStreak + 1 : 1;

          const cards = s.cards.map((c) => {
            if (c.id !== id) return c;
            const box = Math.max(0, Math.min(4, c.box ?? 0));
            if (known) {
              const next = Math.min(4, box + 1);
              return {
                ...c,
                box: next,
                pile: boxToPile(next),
                nextReviewAt: nextReviewForBox(next, now),
                correctStreak: c.correctStreak + 1,
                seenCount: c.seenCount + 1,
                lastSeenAt: now,
              };
            }
            // ❌ em Novas: permanece em Novas, conta como vista (exibe 1/9, 2/8...)
            if (box === 0) {
              return { ...c, box: 0, pile: 'new' as Pile, nextReviewAt: now, correctStreak: 0, seenCount: c.seenCount + 1, lastSeenAt: now };
            }
            const prev = Math.max(0, box - 1);
            return {
              ...c,
              box: prev,
              pile: boxToPile(prev),
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
        const safe = normalizePile(String(pile));
        const map: Record<Pile, number> = { new: 0, check: 1, study: 2, practice: 3, mastered: 4 };
        const box = map[safe];
        set((s) => ({
          cards: s.cards.map((c) =>
            c.id === id
              ? { ...c, pile: safe, box, nextReviewAt: nextReviewForBox(box), lastSeenAt: Date.now() }
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
          const uid = s.user.id;
          appendOp(uid, { type: 'delete-card', id });
          refreshPendingMirror();
          const sentAt = Date.now();
          deleteCardRow(uid, id).then(() => {
            ackOps(uid, listOps(uid).filter((o) => o.type === 'delete-card' && o.id === id && o.ts <= sentAt).map((o) => o.opId));
            refreshPendingMirror();
          }).catch((e) => {
            get().setCloudNotice(cloudErr('Não apaguei na nuvem', 'Cloud delete failed', e));
            void get().flushOutbox().catch(() => {});
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
        // Em modo full todo import ganha id uuid novo: evita colisão com ids de
        // outra conta (o RLS barraria o upsert p/ sempre) e com ids locais
        // não-uuid (o Postgres rejeitaria p/ sempre). Dedupe por EN já ocorreu.
        if (s.user && supabase) {
          batch = batch.map((c) => {
            try {
              return { ...c, id: crypto.randomUUID() };
            } catch {
              return { ...c, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
            }
          });
        }
        if (batch.length > 0) set({ cards: [...batch, ...s.cards] });
        if (s.user && supabase && batch.length > 0) {
          // Enfileira cada card (fiel) e tenta subir; reload converge ids do servidor.
          const jkey = s.user.id;
          for (const c of batch) appendOp(jkey, { type: 'upsert-card', card: c });
          refreshPendingMirror();
          void get().flushOutbox().catch(() => {});
        }
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
            // Falha no meio da jornada do lote: enfileira p/ retry e mantém slots pendentes.
            try {
              const jkey = get().user?.id ?? null;
              if (jkey) {
                appendOp(jkey, { type: 'daily-batch', count: get().autoNewPerDay });
                refreshPendingMirror();
              }
            } catch { /* noop */ }
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
            try {
              const jkey = get().user?.id ?? null;
              if (jkey) {
                appendOp(jkey, { type: 'daily-batch', count: get().autoNewPerDay });
                refreshPendingMirror();
              }
            } catch { /* noop */ }
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

      queuePhoto: (cardId, dataUrl) => {
        appendOp(journalKey(), { type: 'photo', cardId, dataUrl });
        refreshPendingMirror();
        void useStore.getState().flushOutbox().catch(() => {});
      },

      flushOutbox: async (force = false) => {
        const s = get();
        if (!s.user || !supabase) return 0;
        if (s.syncing) return 0;
        const jkey = s.user.id;
        const bo = getBackoff(jkey);
        if (!force && bo.nextRetryAt > Date.now()) return 0;
        const queued = coalesceOps(listOps(jkey));
        if (queued.length === 0) {
          refreshPendingMirror();
          return 0;
        }
        set({ syncing: true });
        const acked: string[] = [];
        let done = 0;
        let failed = false;
        const remainingBatches: typeof queued = [];
        for (const op of queued) {
          try {
            if (op.type === 'delete-card') {
              await deleteCardRow(s.user.id, op.id);
            } else if (op.type === 'photo') {
              const target = ensureCloudCardId(op.cardId) ?? get().cards.find((k) => k.id === op.cardId);
              const dataUrl = op.dataUrl;
              const url = await uploadPhoto(s.user.id, dataUrl);
              const c = target ?? get().cards.find((k) => k.id === op.cardId);
              if (c) {
                const patched = { ...c, photoUrl: url, photo: undefined };
                useStore.setState((st) => ({
                  cards: st.cards.map((k) => (k.id === c.id ? patched : k)),
                }));
                await upsertCardRow(s.user.id, patched);
              }
            } else if (op.type === 'upsert-card') {
              // Usa o estado atual do card (mais fiel que o payload do momento do append).
              // Normaliza id não-uuid antes (causa raiz do banner preso p/ sempre).
              const fixed = ensureCloudCardId(op.card.id);
              const live = fixed ?? get().cards.find((k) => k.id === op.card.id);
              if (!live) {
                // Foi apagado depois — o delete correspondente cobre.
              } else {
                await upsertCardRow(s.user.id, live);
              }
            } else if (op.type === 'meta') {
              const cur = get();
              await syncProfileMeta(s.user.id, {
                xp: cur.xp, dayStreak: cur.dayStreak, bestStreak: cur.bestStreak, lastStudyDate: cur.lastStudyDate,
              });
              const today = new Date().toISOString().slice(0, 10);
              const day = cur.stats.find((d) => d.date === today);
              await upsertStudyDay(s.user.id, today, day?.studied ?? 0, day?.known ?? 0);
            } else if (op.type === 'daily-batch') {
              // Lote diário pendente: tenta resolver agora; se falhar, mantém p/ retry.
              const ok = await resolveDailyBatchOp(op.count);
              if (!ok) {
                remainingBatches.push(op);
                failed = true;
                continue;
              }
            }
            acked.push(op.opId);
            done += 1;
          } catch (e) {
            failed = true;
            try {
              console.warn('[outbox] flush: op falhou — mantida p/ retry', {
                type: op.type,
                id: op.type === 'upsert-card' ? op.card.id : op.type === 'delete-card' ? op.id : op.type === 'photo' ? op.cardId : undefined,
                error: e instanceof Error ? e.message : String(e),
              });
            } catch { /* noop */ }
            if (op.type === 'daily-batch') remainingBatches.push(op);
          }
        }
        // Remove só o que teve ack (limpeza segura). Falhados permanecem.
        ackOps(jkey, acked);
        const left = listOps(jkey).length;
        const attempts = failed || left > 0 ? bo.attempts + 1 : 0;
        setBackoff(jkey, {
          attempts,
          nextRetryAt: failed || left > 0 ? Date.now() + backoffMs(attempts) : 0,
        });
        // Espelho legado zerado — fonte de verdade é o journal v2.
        set({
          syncing: false,
          pendingPhotos: {},
          outbox: { cards: [], deletes: [], meta: false, attempts, nextRetryAt: failed || left > 0 ? Date.now() + backoffMs(attempts) : 0 },
        });
        refreshPendingMirror();
        if ((failed || left > 0) && acked.length === 0 && done === 0) {
          // Nada subiu — mantém aviso sem spam.
          get().setCloudNotice(L() === 'en' ? '⚠️ Some items are still pending sync. I’ll retry automatically.' : '⚠️ Alguns itens seguem pendentes. Vou tentar de novo sozinho.');
          return 0;
        }
        if (left === 0 && !failed) {
          // Pull-after-push: converge com a nuvem (ids gerados no servidor, etc).
          try {
            const ws = await loadWorkspace(s.user.id);
            // Só troca cards se não surgiu nada novo no journal durante o pull.
            if (listOps(jkey).length === 0) set({ cards: ws.cards });
            set({ cloudNotice: null });
          } catch {
            // Journal vazio mas pull falhou — mantém cache fiel + aviso leve.
            get().setCloudNotice(L() === 'en' ? '⚠️ Synced, but cloud refresh failed. Local data kept.' : '⚠️ Sincronizado, mas a leitura da nuvem falhou. Mantive seus dados locais.');
          }
        } else if (failed || left > 0) {
          get().setCloudNotice(L() === 'en' ? '⚠️ Some items are still pending sync. I’ll retry automatically.' : '⚠️ Alguns itens seguem pendentes. Vou tentar de novo sozinho.');
        } else if (done > 0) {
          set({ cloudNotice: null });
        }
        void remainingBatches;
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
            });
          }
        } catch { /* offline — mantém cache local */ }
        try {
          const { data } = await supabase.auth.getSession();
          const u = data.session?.user;
          if (u) {
            await loadFull(u.id, u.email ?? '');
          } else if (workspaceMark() !== 'demo') {
            // Sem sessão mas o workspace persistido era full (app fechado logado
            // ou sessão expirada): esses cards NÃO são demo. Volta ao demo
            // genuíno em vez de exibir dados da conta deslogado.
            const stash = plausibleStash(readStash());
            if (stash) applyDemoStash(stash);
            else applySeedDemo();
            setWorkspaceMark('demo');
            set({ user: null, role: 'user', displayName: '', mustChangePassword: false, tab: 'study' });
            refreshPendingMirror();
          }
        } catch (e) {
          set({ authError: L() === 'en' ? `Could not restore session: ${msg(e)}` : `Falha ao restaurar sessão: ${msg(e)}` });
        } finally {
          set({ authLoading: false });
        }
      },

      signIn: async (email, password) => {
        if (!supabase) {
          set({ authError: noDbMsg() });
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
          set({ authError: noDbMsg() });
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
        // Tenta descarregar a fila da conta atual antes de trocar (se online).
        try {
          await get().flushOutbox().catch(() => {});
        } catch { /* offline — journal por user preservado */ }
        try {
          await supabase?.auth.signOut();
        } catch { /* noop */ }
        // Demo e full são mundos distintos: volta o stash genuíno ou a seed.
        // Stash contaminado (mais cards que o teto demo) é descartado.
        const stash = plausibleStash(readStash());
        if (stash) applyDemoStash(stash);
        else applySeedDemo();
        setWorkspaceMark('demo');
        set({ user: null, role: 'user', displayName: '', mustChangePassword: false, tab: 'study' });
        refreshPendingMirror();
      },

      migrateDemoToCloud: async () => {
        const s = get();
        if (!s.user || !supabase) return 0;
        const stash = plausibleStash(readStash());
        let demoCards = (stash?.cards ?? []).filter((c) => c.en.trim() && c.pt.trim());
        if (demoCards.length === 0) return 0;
        // Seed/demo nasce só com presente — enriquece com os tempos do word_bank
        // antes de inserir, senão o usuário full fica com botões apagados p/ sempre.
        try {
          demoCards = await enrichCardsWithBankTenses(demoCards);
        } catch { /* segue com o original */ }
        try {
          const n = await insertCardRows(s.user.id, demoCards);
          const ws = await loadWorkspace(s.user.id);
          set({ cards: ws.cards });
          // Limpa journal migrado com sucesso.
          ackOps(s.user.id, listOps(s.user.id).map((o) => o.opId));
          refreshPendingMirror();
          return n;
        } catch (e) {
          // Offline/falha: enfileira cada card demo como upsert (fiel + idempotente).
          try {
            for (const c of demoCards) appendOp(s.user.id, { type: 'upsert-card', card: c });
            refreshPendingMirror();
            void get().flushOutbox().catch(() => {});
          } catch { /* noop */ }
          get().setCloudNotice(cloudErr('Migração falhou', 'Migration failed', e));
          return 0;
        }
      },

      adminCreateUser: async (email, password, displayName) => {
        if (!supabase) return { ok: false, msg: noDbMsg() };
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
            return {
              ok: true,
              msg: get().lang === 'en'
                ? `✅ ${cleanEmail} registered! They sign in with the initial password and change it on first access.`
                : `✅ ${cleanEmail} cadastrado! Ele entra com a senha inicial e troca no 1º acesso.`,
            };
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
            msg: get().lang === 'en'
              ? `✅ ${cleanEmail} registered! You were signed out — sign back in as ${adminEmail}. They change the password on first access.`
              : `✅ ${cleanEmail} cadastrado! Você saiu da sua conta — entre de novo como ${adminEmail}. Ele troca a senha no 1º acesso.`,
          };
        }
        return {
          ok: true,
          msg: get().lang === 'en'
            ? `✅ ${cleanEmail} registered! They can sign in and change the password now.`
            : `✅ ${cleanEmail} cadastrado! Ele já pode entrar e trocar a senha.`,
        };
      },

      manageUser: async (action, userId) => {
        if (!supabase) return { ok: false, msg: noDbMsg() };
        if (get().role !== 'admin') return { ok: false, msg: L() === 'en' ? 'Restricted access.' : 'Acesso restrito.' };
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

      adminListUsers: async () => {
        if (!supabase) return { ok: false, msg: noDbMsg(), users: [] };
        if (get().role !== 'admin') {
          return { ok: false, msg: L() === 'en' ? 'Restricted access.' : 'Acesso restrito.', users: [] };
        }
        try {
          const { data, error } = await supabase.functions.invoke<{ ok: boolean; users?: AdminUserRow[]; error?: string }>(
            'admin-manage-user',
            { body: { action: 'list' } },
          );
          if (error) return { ok: false, msg: friendlyAuthError(error.message, get().lang), users: [] };
          if (!(data as { ok?: boolean })?.ok) {
            return { ok: false, msg: friendlyAuthError(String((data as { error?: string })?.error ?? 'error'), get().lang), users: [] };
          }
          return { ok: true, msg: '', users: (data?.users ?? []) as AdminUserRow[] };
        } catch (e) {
          return { ok: false, msg: e instanceof Error ? e.message : String(e), users: [] };
        }
      },

      adminResetPassword: async (userId, password) => {
        if (!supabase) return { ok: false, msg: noDbMsg() };
        if (get().role !== 'admin') return { ok: false, msg: L() === 'en' ? 'Restricted access.' : 'Acesso restrito.' };
        if (passwordIssue(password)) return { ok: false, msg: passwordMsg(get().lang) };
        try {
          const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('admin-manage-user', {
            body: { action: 'reset-password', userId, password },
          });
          if (error) return { ok: false, msg: friendlyAuthError(error.message, get().lang) };
          if (!(data as { ok?: boolean })?.ok) {
            return { ok: false, msg: friendlyAuthError(String((data as { error?: string })?.error ?? 'error'), get().lang) };
          }
          return {
            ok: true,
            msg: get().lang === 'en'
              ? '✅ Password reset! They sign in with the new password and change it on first access.'
              : '✅ Senha redefinida! Ele entra com a nova senha e troca no 1º acesso.',
          };
        } catch (e) {
          return { ok: false, msg: e instanceof Error ? e.message : String(e) };
        }
      },

      updateDisplayName: async (name) => {
        const clean = name.trim();
        if (!clean) {
          return { ok: false, msg: get().lang === 'en' ? 'Type a name.' : 'Digite um nome.' };
        }
        if (!supabase || !get().user) return { ok: false, msg: noDbMsg() };
        try {
          const { error } = await supabase.from('profiles').update({ display_name: clean }).eq('id', get().user!.id);
          if (error) throw error;
          try {
            await supabase.auth.updateUser({ data: { display_name: clean } });
          } catch { /* metadata é bônus */ }
          set({ displayName: clean });
          return { ok: true, msg: get().lang === 'en' ? '✅ Name updated!' : '✅ Nome atualizado!' };
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
      version: 5,
      migrate: ((persisted: unknown) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const ob = (p.outbox ?? {}) as Record<string, unknown>;
        const rawCards = Array.isArray(p.cards) ? (p.cards as Card[]) : [];
        const cards = rawCards.map((c) => {
          const pile = normalizePile(String((c as Card).pile ?? 'new'));
          const map: Record<string, number> = { new: 0, check: 1, study: 2, practice: 3, mastered: 4 };
          let box = Number((c as Card).box ?? map[pile] ?? 0);
          if (!Number.isFinite(box)) box = map[pile] ?? 0;
          // Legado 0..5 → 0..4; piles antigas learning/known ganham box coerente
          if (box > 4) box = 4;
          const raw = String((c as Card).pile ?? '');
          if (raw === 'learning' && box <= 1) box = 3;
          if (raw === 'known' && box < 4) box = 4;
          if (raw === 'due') box = 2;
          return { ...c, pile, box };
        });
        const rawFilter = String(p.pileFilter ?? 'new');
        const pileFilter = rawFilter === 'due' || rawFilter === 'learning' || rawFilter === 'known' || rawFilter === 'all'
          ? ('new' as const)
          : (normalizePile(rawFilter) as Pile | 'all');
        const { ttsEngine: _e, ttsVoiceEN: _en, ttsVoicePT: _pt, ttsRate: _r, ...rest } = p;
        void _e; void _en; void _pt; void _r;
        // Migra fila legada v4 (ids + pendingPhotos dentro do persist) para o journal v2
        // por-usuário. Roda 1x; journal v2 vive fora do persist (chave própria).
        try {
          const legacyCards = Array.isArray(ob.cards) ? (ob.cards as string[]) : [];
          const legacyDeletes = Array.isArray(ob.deletes) ? (ob.deletes as string[]) : [];
          const legacyMeta = (ob.meta as boolean) === true;
          const legacyPhotos = (p.pendingPhotos ?? {}) as Record<string, string>;
          const hasLegacy = legacyCards.length > 0 || legacyDeletes.length > 0 || legacyMeta || Object.keys(legacyPhotos).length > 0;
          if (hasLegacy) {
            const stats = Array.isArray(p.stats) ? (p.stats as DayStat[]) : [];
            const today = new Date().toISOString().slice(0, 10);
            const day = stats.find((d) => d.date === today) ?? null;
            const ops = legacyToOps({
              cards: legacyCards,
              deletes: legacyDeletes,
              meta: legacyMeta,
              allCards: cards,
              pendingPhotos: legacyPhotos,
              metaSnapshot: {
                xp: Number(p.xp ?? 0) || 0,
                dayStreak: Number(p.dayStreak ?? 0) || 0,
                bestStreak: Number(p.bestStreak ?? 0) || 0,
                lastStudyDate: String(p.lastStudyDate ?? ''),
                day,
              },
            });
            if (ops.length > 0) {
              // Sem userId aqui (sessão ainda não restaurada) → vai para a chave demo;
              // no login, o flush da conta atual + repull convergem. Se já houver
              // journal, anexa sem duplicar por coalesce.
              const existing = listOps(null);
              replaceOps(null, [...existing, ...ops]);
            }
          }
        } catch { /* migração nunca quebra o boot */ }
        return {
          ...rest,
          cards,
          pileFilter,
          autoAddTimes: Array.isArray(p.autoAddTimes) && (p.autoAddTimes as unknown[]).length > 0
            ? p.autoAddTimes
            : [...DEFAULT_AUTO_ADD_TIMES],
          lastAutoAddSlots: (p.lastAutoAddSlots ?? {}) as Record<string, string>,
          lastAutoAddDate: (p.lastAutoAddDate ?? '') as string,
          // Legado limpo: journal v2 é a fonte de verdade (fora do persist).
          pendingPhotos: {},
          pendingCount: 0,
          outbox: { cards: [], deletes: [], meta: false, attempts: 0, nextRetryAt: 0 },
        } as unknown as Store;
      }) as unknown as (persistedState: unknown, version: number) => Store,
      partialize: ((s: Store) => ({
        cards: s.cards,
        theme: s.theme,
        pileFilter: s.pileFilter,
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
      })) as unknown as (s: Store) => Store,
    },
  ),
);

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Sobe um card alterado para a nuvem (somente modo full; silencioso no demo). */
async function syncCard(id: string): Promise<void> {
  const s = useStore.getState();
  if (!s.user || !supabase) return;
  const uid = s.user.id;
  const c = ensureCloudCardId(id);
  if (!c) return;
  const sentAt = Date.now();
  // Journal-first (fiel): grava a op antes de tentar a rede.
  appendOp(uid, { type: 'upsert-card', card: c });
  refreshPendingMirror();
  try {
    const live = useStore.getState().cards.find((k) => k.id === c.id) ?? c;
    await upsertCardRow(uid, live);
    // Ack preciso: só ops até o envio (edição mais nova concomitante preservada).
    ackOps(uid, listOps(uid).filter((o) => o.type === 'upsert-card' && o.card.id === c.id && o.ts <= sentAt).map((o) => o.opId));
    refreshPendingMirror();
  } catch (e) {
    useStore.getState().setCloudNotice(cloudErr('Não salvei na nuvem', 'Cloud save failed', e));
    try {
      console.warn('[outbox] syncCard falhou — op mantida p/ retry', { id: c.id, error: e });
    } catch { /* noop */ }
    void useStore.getState().flushOutbox().catch(() => {});
  }
}

/** Sobe XP/streak + dia com totais absolutos (idempotente — seguro repetir no flush). */
async function syncProgress(_studiedDelta: number, _knownDelta: number): Promise<void> {
  const s = useStore.getState();
  if (!s.user || !supabase) return;
  const uid = s.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const day = s.stats.find((d) => d.date === today) ?? { date: today, studied: 0, known: 0 };
  const sentAt = Date.now();
  appendOp(uid, {
    type: 'meta', xp: s.xp, dayStreak: s.dayStreak, bestStreak: s.bestStreak,
    lastStudyDate: s.lastStudyDate, day,
  });
  refreshPendingMirror();
  try {
    await syncProfileMeta(uid, {
      xp: s.xp, dayStreak: s.dayStreak, bestStreak: s.bestStreak, lastStudyDate: s.lastStudyDate,
    });
    await upsertStudyDay(uid, today, day?.studied ?? 0, day?.known ?? 0);
    // Ack dos metas até o envio (estado absoluto atual prevalece).
    ackOps(uid, listOps(uid).filter((o) => o.type === 'meta' && o.ts <= sentAt).map((o) => o.opId));
    refreshPendingMirror();
  } catch (e) {
    useStore.getState().setCloudNotice(cloudErr('Não salvei na nuvem', 'Cloud save failed', e));
    try {
      console.warn('[outbox] syncProgress falhou — op mantida p/ retry', { error: e });
    } catch { /* noop */ }
    void useStore.getState().flushOutbox().catch(() => {});
  }
}

/** Resolve um lote diário pendente (op daily-batch). Retorna true se OK ou nada a fazer. */
async function resolveDailyBatchOp(count: number): Promise<boolean> {
  const s = useStore.getState();
  if (!s.user || !supabase) return false;
  try {
    const ownedEN = new Set(s.cards.map((c) => normalizeEN(c.en)));
    const ownedBankIds = new Set(s.cards.flatMap((c) => (c.bankId ? [c.bankId] : [])));
    let batch = await fetchBankBatch(ownedEN, ownedBankIds, count);
    if (batch.length === 0) {
      try {
        batch = await generateBankBatch(count);
      } catch { /* mantém vazio */ }
    }
    if (batch.length === 0) return true; // nada a entregar — considera resolvido
    const at = Date.now();
    const fresh = batch.map((row, i) => bankRowToCard(row, i, at + i));
    await insertCardRows(s.user.id, fresh);
    const ws = await loadWorkspace(s.user.id);
    // Só aplica se não surgiram ops novas durante a resolução.
    if (listOps(s.user.id).length >= 0) useStore.setState({ cards: ws.cards });
    return true;
  } catch {
    return false;
  }
}

/** Carrega workspace full: preserva o demo em stash e troca o conjunto de trabalho.
 * Retorna false se a conta estiver bloqueada (derruba a sessão).
 * Offline/falha: mantém cache local fiel + sessão, marca stale e agenda flush. */
async function loadFull(userId: string, email: string): Promise<boolean> {
  const s = useStore.getState();
  // Só preserva o demo se o workspace atual É demo (marca de proveniência).
  // Sem isso, cards full persistidos (app fechado logado / sessão expirada)
  // seriam guardados no stash e voltariam no logout, estourando o teto demo.
  if (!s.user && workspaceMark() === 'demo') stashDemo(s);
  // Define a sessão primeiro para o journal por-user funcionar mesmo offline.
  useStore.setState({
    user: { id: userId, email },
    authError: null,
    tab: 'study',
  });
  setWorkspaceMark(`full:${userId}`);
  // Adota journal órfão da chave demo (migração v4→v5 roda sem sessão e não
  // sabe o userId). Traz deletes/upserts/photos — meta/daily-batch da era
  // demo seriam obsoletos e poderiam clobberar a nuvem, então descarta.
  try {
    const orphaned = listOps(null).filter((o) => o.type !== 'meta' && o.type !== 'daily-batch');
    if (orphaned.length > 0) {
      for (const o of orphaned) {
        if (o.type === 'delete-card') appendOp(userId, { type: 'delete-card', id: o.id });
        else if (o.type === 'photo') appendOp(userId, { type: 'photo', cardId: o.cardId, dataUrl: o.dataUrl });
        else if (o.type === 'upsert-card') appendOp(userId, { type: 'upsert-card', card: o.card });
      }
      replaceOps(null, []);
    }
  } catch { /* adoção nunca quebra o login */ }
  refreshPendingMirror();
  let ws: Awaited<ReturnType<typeof loadWorkspace>> | null = null;
  try {
    ws = await loadWorkspace(userId);
  } catch (e) {
    // Falha compromete a jornada de carga: não zera nada, mantém cache fiel.
    useStore.getState().setCloudNotice(cloudErr('Nuvem indisponível — mantive seus dados locais', 'Cloud unavailable — kept local data', e));
    // Tenta descarregar o que já estava no journal assim que possível.
    void useStore.getState().flushOutbox().catch(() => {});
    return true;
  }
  if (ws.isBlocked) {
    try {
      await supabase?.auth.signOut();
    } catch { /* noop */ }
    // Conta bloqueada: derruba a sessão E o workspace full (não exibe dados da conta).
    const blockedStash = plausibleStash(readStash());
    if (blockedStash) applyDemoStash(blockedStash);
    else applySeedDemo();
    setWorkspaceMark('demo');
    useStore.setState({
      user: null, role: 'user', displayName: '', mustChangePassword: false,
      authError: useStore.getState().lang === 'en'
        ? '⛔ This account is blocked. Talk to the administrator.'
        : '⛔ Esta conta está bloqueada. Fale com o administrador.',
      showAuth: true,
    });
    refreshPendingMirror();
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
  refreshPendingMirror();
  // Se havia journal pendente dessa conta, tenta descarregar agora.
  void useStore.getState().flushOutbox().catch(() => {});
  return true;
}

function inviteLocked(count: number): void {
  const max = useStore.getState().demoMax;
  useStore.setState({
    showInvite: true,
    inviteMsg: L() === 'en'
      ? `You reached ${count} of ${max} words in demo mode 🎓 — request your access to continue with unlimited words. Your current progress migrates automatically.`
      : `Você atingiu ${count} de ${max} palavras no modo demo 🎓 — solicite seu acesso para continuar com palavras ilimitadas. Seu progresso atual é migrado automaticamente.`,
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
