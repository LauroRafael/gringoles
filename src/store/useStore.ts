import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildSeedCards } from '../data/seed';
import { materializeBankEntry, pickDailyWords } from '../data/bank';
import { findDuplicate, normalizeEN, splitNewVsDuplicates } from '../lib/dedupe';
import { STORE_KEY, THEME_KEY } from '../lib/migrateLocal';
import { nextReviewForBox } from '../lib/srs';
import { supabase } from '../lib/supabase';
import type { Lang } from '../lib/i18n';
import {
  bankRowToCard,
  bumpStudyDay,
  deleteCardRow,
  fetchBankBatch,
  insertCardRows,
  loadWorkspace,
  syncProfileMeta,
  upsertCardRow,
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
  newPerDay: number;
  autoNewPerDay: number;
  autoAddEnabled: boolean;
  demoMax: number;
  labelLearning: string;
  labelKnown: string;
  lang: Lang;
}

function stashDemo(s: Store): void {
  try {
    const stash: DemoStash = {
      cards: s.cards, xp: s.xp, stats: s.stats, dayStreak: s.dayStreak,
      bestStreak: s.bestStreak, lastStudyDate: s.lastStudyDate,
      lastAutoAddDate: s.lastAutoAddDate, newPerDay: s.newPerDay,
      autoNewPerDay: s.autoNewPerDay, autoAddEnabled: s.autoAddEnabled,
      demoMax: s.demoMax, labelLearning: s.labelLearning, labelKnown: s.labelKnown,
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

function friendlyAuthError(msg: string, lang: Lang = 'pt'): string {
  const en = lang === 'en';
  if (/invalid login credentials/i.test(msg)) return en ? 'Invalid email or password.' : 'E-mail ou senha inválidos.';
  if (/user already registered/i.test(msg)) return en ? 'This email already has an account. Try logging in.' : 'Este e-mail já tem conta. Tente entrar.';
  if (/password should be/i.test(msg)) return en ? 'Password must be at least 6 characters.' : 'A senha deve ter ao menos 6 caracteres.';
  if (/email.*confirm/i.test(msg)) return en ? 'Confirm your email before logging in.' : 'Confirme seu e-mail antes de entrar.';
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
  /** Palavras automáticas do banco por dia (configurável). */
  autoNewPerDay: number;
  autoAddEnabled: boolean;
  lastAutoAddDate: string;
  /** Teto de palavras do modo demo (editável no admin). */
  demoMax: number;
  /** Rótulos das pilhas (editáveis no admin). */
  labelLearning: string;
  labelKnown: string;
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
  setDemoMax: (n: number) => void;
  setLabelLearning: (s: string) => void;
  setLabelKnown: (s: string) => void;
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
      lastAutoAddDate: '',
      demoMax: DEMO_MAX_DEFAULT,
      labelLearning: 'Não sei',
      labelKnown: 'Sei',
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
      inviteMsg: '',
      mustChangePassword: false,
      cloudNotice: null,

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
      setNewPerDay: (newPerDay) => set({ newPerDay }),

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
          deleteCardRow(s.user.id, id).catch((e) =>
            get().setCloudNotice(cloudErr('Não apaguei na nuvem', 'Cloud delete failed', e)),
          );
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

      setAutoNewPerDay: (autoNewPerDay) => set({ autoNewPerDay }),
      setAutoAddEnabled: (autoAddEnabled) => set({ autoAddEnabled }),
      setDemoMax: (demoMax) => set({ demoMax: Math.max(1, demoMax) }),
      setLabelLearning: (labelLearning) =>
        set({ labelLearning: labelLearning.trim().slice(0, 24) || 'Não sei' }),
      setLabelKnown: (labelKnown) =>
        set({ labelKnown: labelKnown.trim().slice(0, 24) || 'Sei' }),
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
        if (s.lastAutoAddDate === today) return 0;
        if (s.user && supabase) {
          try {
            const ownedEN = new Set(s.cards.map((c) => normalizeEN(c.en)));
            const ownedBankIds = new Set(s.cards.flatMap((c) => (c.bankId ? [c.bankId] : [])));
            const batch = await fetchBankBatch(ownedEN, ownedBankIds, s.autoNewPerDay);
            if (batch.length === 0) {
              set({ lastAutoAddDate: today });
              return 0;
            }
            const now = Date.now();
            const fresh = batch.map((row, i) => bankRowToCard(row, i, now));
            await insertCardRows(s.user.id, fresh);
            const ws = await loadWorkspace(s.user.id);
            set({ cards: ws.cards, lastAutoAddDate: today });
            return fresh.length;
          } catch (e) {
            get().setCloudNotice(cloudErr('Lote diário falhou', 'Daily batch failed', e));
            return 0;
          }
        }
        // ---- demo local (com teto) ----
        const room = Math.max(0, s.demoMax - s.cards.length);
        if (room <= 0) {
          inviteLocked(s.cards.length);
          return 0;
        }
        const picked = pickDailyWords(s.cards, Math.min(s.autoNewPerDay, room));
        const now = Date.now();
        const fresh = picked.map((e, i) => materializeBankEntry(e, i, now));
        set({
          cards: [...fresh, ...s.cards],
          lastAutoAddDate: today,
        });
        return fresh.length;
      },

      topUpNow: async (): Promise<number> => {
        set({ lastAutoAddDate: '' });
        return get().ensureDailyWords();
      },

      // ---------- sessão / nuvem ----------
      setShowAuth: (showAuth) => set({ showAuth, authError: null, authNotice: null }),
      setShowTutorial: (showTutorial) => set({ showTutorial }),
      setShowInvite: (showInvite, inviteMsg) =>
        set((s) => ({ showInvite, inviteMsg: inviteMsg ?? s.inviteMsg })),
      clearCloudNotice: () => set({ cloudNotice: null }),
      setCloudNotice: (cloudNotice) => set({ cloudNotice }),

      initAuth: async () => {
        if (!supabase) {
          set({ authLoading: false });
          return;
        }
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
        await loadFull(data.user.id, data.user.email ?? email);
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
          set({ authNotice: get().lang === 'en' ? '📧 Account created! Confirm your email, then log in.' : '📧 Conta criada! Confirme seu e-mail e entre.' });
          return false;
        }
        await loadFull(data.user.id, data.user.email ?? email);
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
            newPerDay: stash.newPerDay, autoNewPerDay: stash.autoNewPerDay,
            autoAddEnabled: stash.autoAddEnabled,
            demoMax: stash.demoMax ?? DEMO_MAX_DEFAULT,
            labelLearning: stash.labelLearning || 'Não sei',
            labelKnown: stash.labelKnown || 'Sei',
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
        const adminEmail = get().user?.email ?? '';
        const cleanEmail = email.trim();
        if (!/.+@.+\..+/.test(cleanEmail)) return { ok: false, msg: get().lang === 'en' ? 'Invalid email.' : 'E-mail inválido.' };
        if (password.length < 6) return { ok: false, msg: get().lang === 'en' ? 'Password must be at least 6 characters.' : 'A senha deve ter ao menos 6 caracteres.' };
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { display_name: displayName.trim() || cleanEmail.split('@')[0] } },
        });
        if (error) return { ok: false, msg: friendlyAuthError(error.message, get().lang) };
        if (data.session && data.user) {
          // Projeto sem confirmação de e-mail: o signUp logou como o novo usuário.
          // Restaura o admin e orienta a promover/entrar.
          await supabase.auth.signOut();
          await get().signOut();
          return {
            ok: true,
            msg: `✅ ${cleanEmail} cadastrado! Você saiu da sua conta — entre de novo como ${adminEmail} para continuar administrando.`,
          };
        }
        return { ok: true, msg: `✅ ${cleanEmail} cadastrado! Ele deve confirmar o e-mail e entrar.` };
      },

      changePassword: async (password) => {
        if (!supabase) return false;
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
        lastAutoAddDate: s.lastAutoAddDate,
        demoMax: s.demoMax,
        labelLearning: s.labelLearning,
        labelKnown: s.labelKnown,
        lang: s.lang,
      }),
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
  const c = s.cards.find((k) => k.id === id);
  if (!c) return;
  try {
    await upsertCardRow(s.user.id, c);
  } catch (e) {
    useStore.getState().setCloudNotice(cloudErr('Não salvei na nuvem', 'Cloud save failed', e));
  }
}

/** Sobe XP/streak + dia de estudo (somente modo full). */
async function syncProgress(studiedDelta: number, knownDelta: number): Promise<void> {
  const s = useStore.getState();
  if (!s.user || !supabase) return;
  try {
    await syncProfileMeta(s.user.id, {
      xp: s.xp, dayStreak: s.dayStreak, bestStreak: s.bestStreak, lastStudyDate: s.lastStudyDate,
    });
    await bumpStudyDay(s.user.id, new Date().toISOString().slice(0, 10), studiedDelta, knownDelta);
  } catch (e) {
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

/** Carrega workspace full: preserva o demo em stash e troca o conjunto de trabalho. */
async function loadFull(userId: string, email: string): Promise<void> {
  const s = useStore.getState();
  if (!s.user) stashDemo(s);
  const ws = await loadWorkspace(userId);
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
