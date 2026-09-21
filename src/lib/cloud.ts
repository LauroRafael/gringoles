import { supabase } from './supabase';
import type { Card, DayStat, Pile } from '../types';

/** Linha da tabela public.cards */
export interface CardRow {
  id: string;
  user_id: string;
  en: string;
  pt: string;
  phonetic_br: string;
  ipa: string;
  example_en: string;
  example_pt: string;
  emoji: string;
  photo_url: string | null;
  gradient: string;
  category: string;
  pile: Pile;
  box: number;
  next_review_at: string;
  correct_streak: number;
  seen_count: number;
  bank_id: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export function rowToCard(r: CardRow, photoFallback?: string): Card {
  return {
    id: r.id,
    en: r.en,
    pt: r.pt,
    phoneticBR: r.phonetic_br,
    ipa: r.ipa,
    exampleEN: r.example_en,
    examplePT: r.example_pt,
    emoji: r.emoji,
    photo: photoFallback,
    photoUrl: r.photo_url ?? undefined,
    gradient: r.gradient,
    category: r.category,
    pile: r.pile,
    box: r.box,
    nextReviewAt: new Date(r.next_review_at).getTime(),
    correctStreak: r.correct_streak,
    seenCount: r.seen_count,
    bankId: r.bank_id ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : undefined,
  };
}

export function cardToRow(userId: string, c: Card): Omit<CardRow, 'created_at'> & { created_at?: string } {
  return {
    id: c.id,
    user_id: userId,
    en: c.en,
    pt: c.pt,
    phonetic_br: c.phoneticBR,
    ipa: c.ipa,
    example_en: c.exampleEN,
    example_pt: c.examplePT,
    emoji: c.emoji,
    photo_url: c.photoUrl ?? null,
    gradient: c.gradient,
    category: c.category,
    pile: c.pile,
    box: c.box,
    next_review_at: new Date(c.nextReviewAt).toISOString(),
    correct_streak: c.correctStreak,
    seen_count: c.seenCount,
    bank_id: c.bankId ?? null,
    last_seen_at: c.lastSeenAt ? new Date(c.lastSeenAt).toISOString() : null,
  };
}

function mustDb() {
  if (!supabase) throw new Error('Supabase não configurado (.env ausente).');
  return supabase;
}

export interface CloudWorkspace {
  cards: Card[];
  stats: DayStat[];
  xp: number;
  dayStreak: number;
  bestStreak: number;
  lastStudyDate: string;
  role: 'user' | 'admin';
  displayName: string;
  mustChangePassword: boolean;
}

export async function loadWorkspace(userId: string): Promise<CloudWorkspace> {
  const db = mustDb();
  const [cardsRes, daysRes, profRes] = await Promise.all([
    db.from('cards').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(2000),
    db.from('study_days').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(60),
    db.from('profiles').select('role,display_name,xp,day_streak,best_streak,last_study_date,must_change_password').eq('id', userId).single(),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (daysRes.error) throw daysRes.error;
  if (profRes.error) throw profRes.error;
  const p = profRes.data as {
    role: string; display_name: string | null; xp: number; day_streak: number;
    best_streak: number; last_study_date: string; must_change_password: boolean;
  };
  return {
    cards: (cardsRes.data as CardRow[]).map((r) => rowToCard(r)),
    stats: (daysRes.data as { date: string; studied: number; known: number }[]).map((d) => ({
      date: d.date, studied: d.studied, known: d.known,
    })),
    xp: p.xp ?? 0,
    dayStreak: p.day_streak ?? 0,
    bestStreak: p.best_streak ?? 0,
    lastStudyDate: p.last_study_date ?? '',
    role: p.role === 'admin' ? 'admin' : 'user',
    displayName: p.display_name ?? '',
    mustChangePassword: p.must_change_password ?? false,
  };
}

export async function upsertCardRow(userId: string, c: Card): Promise<void> {
  const db = mustDb();
  const { error } = await db.from('cards').upsert(cardToRow(userId, c), { onConflict: 'id' });
  if (error) throw error;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Insere lote filtrando EN já existentes (dedupe em JS — previsível e sem conflito). Retorna qtd inserida. */
export async function insertCardRows(userId: string, cards: Card[]): Promise<number> {
  if (cards.length === 0) return 0;
  const db = mustDb();
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const { data: existing, error: e0 } = await db.from('cards').select('en').eq('user_id', userId).limit(5000);
  if (e0) throw e0;
  const seen = new Set((existing as { en: string }[]).map((r) => norm(r.en)));
  const fresh = cards.filter((c) => {
    const k = norm(c.en);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (fresh.length === 0) return 0;
  const rows = fresh.map((c) => {
    const row = cardToRow(userId, c);
    // id local (ex: "seed-...") não é uuid → deixa o banco gerar
    if (!UUID_RE.test(c.id)) delete (row as { id?: string }).id;
    return row;
  });
  const { data, error } = await db.from('cards').insert(rows).select('id,en');
  if (error) throw error;
  return (data as unknown[]).length;
}

export async function deleteCardRow(userId: string, id: string): Promise<void> {
  const db = mustDb();
  const { error } = await db.from('cards').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function syncProfileMeta(userId: string, meta: { xp: number; dayStreak: number; bestStreak: number; lastStudyDate: string }): Promise<void> {
  const db = mustDb();
  const { error } = await db.from('profiles').update({
    xp: meta.xp, day_streak: meta.dayStreak, best_streak: meta.bestStreak, last_study_date: meta.lastStudyDate,
  }).eq('id', userId);
  if (error) throw error;
}

export async function bumpStudyDay(userId: string, date: string, studiedDelta: number, knownDelta: number): Promise<void> {
  const db = mustDb();
  const { data, error } = await db.from('study_days').select('studied,known').eq('user_id', userId).eq('date', date).single();
  if (error && (error as { code?: string }).code !== 'PGRST116') throw error;
  if (data) {
    const { error: e2 } = await db.from('study_days').update({
      studied: (data as { studied: number }).studied + studiedDelta,
      known: (data as { known: number }).known + knownDelta,
    }).eq('user_id', userId).eq('date', date);
    if (e2) throw e2;
  } else {
    const { error: e2 } = await db.from('study_days').insert({ user_id: userId, date, studied: studiedDelta, known: knownDelta });
    if (e2) throw e2;
  }
}

export async function uploadPhoto(userId: string, dataUrl: string): Promise<string> {
  const db = mustDb();
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await db.storage.from('card-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = db.storage.from('card-photos').getPublicUrl(path);
  return data.publicUrl;
}

const GRADIENTS = [
  'from-sapphire to-carolina',
  'from-prussian to-celadon',
  'from-celadon to-carolina',
  'from-sapphire to-celadon',
  'from-prussian to-sapphire',
  'from-carolina to-celadon',
  'from-prussian to-carolina',
  'from-celadon to-azure',
];

export interface BankRow {
  bank_id: string; en: string; pt: string; phonetic_br: string; ipa: string;
  example_en: string; example_pt: string; emoji: string; category: string;
}

/** Converte linha do word_bank em Card novo (id temporário — o banco gera uuid no insert). */
export function bankRowToCard(row: BankRow, index: number, now = Date.now()): Card {
  return {
    id: `auto-${row.bank_id}-${now}`,
    en: row.en,
    pt: row.pt,
    phoneticBR: row.phonetic_br,
    ipa: row.ipa,
    exampleEN: row.example_en,
    examplePT: row.example_pt,
    emoji: row.emoji,
    gradient: GRADIENTS[index % GRADIENTS.length],
    category: row.category,
    pile: 'new',
    box: 0,
    nextReviewAt: now,
    correctStreak: 0,
    seenCount: 0,
    createdAt: now + index,
    bankId: row.bank_id,
  };
}

/** Traz o lote diário do word_bank (servidor), excluindo EN/bank_id já possuídos. */
export async function fetchBankBatch(ownedEN: Set<string>, ownedBankIds: Set<string>, count: number) {
  const db = mustDb();
  const { data, error } = await db.from('word_bank').select('*').eq('active', true).order('bank_id').limit(1000);
  if (error) throw error;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const picked: NonNullable<typeof data> = [];
  for (const row of data ?? []) {
    if (picked.length >= count) break;
    if (ownedBankIds.has(row.bank_id) || ownedEN.has(norm(row.en))) continue;
    picked.push(row);
  }
  return picked;
}
