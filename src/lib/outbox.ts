import type { Card, DayStat } from '../types';

/** Limites acordados: 500 ops no journal, 10 fotos pendentes. */
export const OUTBOX_MAX_OPS = 500;
export const OUTBOX_MAX_PHOTOS = 10;

const KEY_PREFIX = 'gringoles-outbox-v2:';
const META_SUFFIX = ':meta';

export type OutboxOp =
  | { opId: string; ts: number; type: 'upsert-card'; card: Card }
  | { opId: string; ts: number; type: 'delete-card'; id: string }
  | {
      opId: string; ts: number; type: 'meta';
      xp: number; dayStreak: number; bestStreak: number; lastStudyDate: string; day: DayStat;
    }
  | { opId: string; ts: number; type: 'photo'; cardId: string; dataUrl: string }
  | { opId: string; ts: number; type: 'daily-batch'; count: number };

export interface OutboxBackoff {
  attempts: number;
  nextRetryAt: number;
}

function keyFor(userId: string | null): string {
  return `${KEY_PREFIX}${userId ?? 'demo'}`;
}

function metaKeyFor(userId: string | null): string {
  return `${KEY_PREFIX}${userId ?? 'demo'}${META_SUFFIX}`;
}

export function newOpId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fallback abaixo */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listOps(userId: string | null): OutboxOp[] {
  const ops = safeRead<OutboxOp[]>(keyFor(userId), []);
  return Array.isArray(ops) ? ops : [];
}

export function getBackoff(userId: string | null): OutboxBackoff {
  const b = safeRead<OutboxBackoff>(metaKeyFor(userId), { attempts: 0, nextRetryAt: 0 });
  return {
    attempts: Number(b.attempts ?? 0) || 0,
    nextRetryAt: Number(b.nextRetryAt ?? 0) || 0,
  };
}

export function setBackoff(userId: string | null, b: OutboxBackoff): void {
  safeWrite(metaKeyFor(userId), b);
}

/** Backoff exponencial: 5s, 30s, 2min, 10min (teto). */
export function backoffMs(attempts: number): number {
  const table = [5000, 30000, 120000, 600000];
  return table[Math.min(Math.max(0, attempts), table.length - 1)];
}

function enforceCaps(ops: OutboxOp[]): { ops: OutboxOp[]; droppedPhoto: boolean } {
  let droppedPhoto = false;
  let next = [...ops];
  // Cap de fotos: mantém as 10 mais recentes.
  const photoIdx = next.map((o, i) => (o.type === 'photo' ? i : -1)).filter((i) => i >= 0);
  if (photoIdx.length > OUTBOX_MAX_PHOTOS) {
    const drop = photoIdx.length - OUTBOX_MAX_PHOTOS;
    const dropSet = new Set(photoIdx.slice(0, drop));
    next = next.filter((_, i) => !dropSet.has(i));
    droppedPhoto = true;
  }
  // Cap total: descarta daily-batch mais antigo primeiro; depois upsert-card mais antigo
  // (nunca descarta delete/meta/photo aqui — fidelidade).
  while (next.length > OUTBOX_MAX_OPS) {
    const dbIdx = next.findIndex((o) => o.type === 'daily-batch');
    if (dbIdx >= 0) {
      next.splice(dbIdx, 1);
      continue;
    }
    const upIdx = next.findIndex((o) => o.type === 'upsert-card');
    if (upIdx >= 0) {
      next.splice(upIdx, 1);
      continue;
    }
    break;
  }
  return { ops: next, droppedPhoto };
}

/** Op sem opId/ts (preenchidos no append). Distributivo por tipo — evita Omit em união. */
export type UnsavedOp =
  | { type: 'upsert-card'; card: Card; opId?: string; ts?: number }
  | { type: 'delete-card'; id: string; opId?: string; ts?: number }
  | {
      type: 'meta'; xp: number; dayStreak: number; bestStreak: number;
      lastStudyDate: string; day: DayStat; opId?: string; ts?: number;
    }
  | { type: 'photo'; cardId: string; dataUrl: string; opId?: string; ts?: number }
  | { type: 'daily-batch'; count: number; opId?: string; ts?: number };

export function appendOp(
  userId: string | null,
  op: UnsavedOp,
): { opId: string; droppedPhoto: boolean } {
  const full = { ...op, opId: op.opId ?? newOpId(), ts: op.ts ?? Date.now() } as OutboxOp;
  const current = listOps(userId);
  const { ops, droppedPhoto } = enforceCaps([...current, full]);
  safeWrite(keyFor(userId), ops);
  // Reset do backoff para tentar em breve (nova mutação = sinal de atividade).
  setBackoff(userId, { attempts: 0, nextRetryAt: 0 });
  return { opId: full.opId, droppedPhoto };
}

export function ackOps(userId: string | null, opIds: string[]): void {
  if (opIds.length === 0) return;
  const done = new Set(opIds);
  const rest = listOps(userId).filter((o) => !done.has(o.opId));
  safeWrite(keyFor(userId), rest);
  if (rest.length === 0) setBackoff(userId, { attempts: 0, nextRetryAt: 0 });
}

export function replaceOps(userId: string | null, ops: OutboxOp[]): void {
  safeWrite(keyFor(userId), ops.slice(-OUTBOX_MAX_OPS));
}

export function clearOutbox(userId: string | null): void {
  try {
    localStorage.removeItem(keyFor(userId));
    localStorage.removeItem(metaKeyFor(userId));
  } catch { /* noop */ }
}

/** Reaponta ops (photo/upsert) de um card cujo id local foi normalizado para uuid. */
export function remapCardIdInOps(userId: string | null, oldId: string, newId: string): void {
  if (oldId === newId) return;
  try {
    const next = listOps(userId).map((o) => {
      if (o.type === 'photo' && o.cardId === oldId) return { ...o, cardId: newId };
      if (o.type === 'upsert-card' && o.card.id === oldId) return { ...o, card: { ...o.card, id: newId } };
      return o;
    });
    safeWrite(keyFor(userId), next);
  } catch { /* noop */ }
}

/**
 * Coalesce para replay fiel e econômico:
 * - delete cancela upserts/photos anteriores do mesmo id (mantém só o delete);
 * - múltiplos upserts do mesmo id → mantém o último (estado absoluto final);
 * - múltiplos meta → mantém o último;
 * - photos: mantém a última por cardId.
 */
export function coalesceOps(ops: OutboxOp[]): OutboxOp[] {
  const deletedIds = new Set(ops.filter((o) => o.type === 'delete-card').map((o) => o.id));
  const lastUpsert = new Map<string, OutboxOp>();
  const lastPhoto = new Map<string, OutboxOp>();
  let lastMeta: OutboxOp | null = null;
  const deletes: OutboxOp[] = [];
  const batches: OutboxOp[] = [];
  for (const o of ops) {
    if (o.type === 'delete-card') deletes.push(o);
    else if (o.type === 'upsert-card') lastUpsert.set(o.card.id, o);
    else if (o.type === 'photo') lastPhoto.set(o.cardId, o);
    else if (o.type === 'meta') lastMeta = o;
    else if (o.type === 'daily-batch') batches.push(o);
  }
  // Remove upserts/photos de cards deletados.
  for (const id of deletedIds) {
    lastUpsert.delete(id);
    lastPhoto.delete(id);
  }
  const out: OutboxOp[] = [
    ...deletes,
    ...[...lastPhoto.values()].sort((a, b) => a.ts - b.ts),
    ...[...lastUpsert.values()].sort((a, b) => a.ts - b.ts),
  ];
  if (lastMeta) out.push(lastMeta);
  out.push(...batches.sort((a, b) => a.ts - b.ts));
  return out;
}

/** Converte formato legado v4 (ids + pendingPhotos) para Ops v2. */
export function legacyToOps(args: {
  cards: string[];
  deletes: string[];
  meta: boolean;
  allCards: Card[];
  pendingPhotos: Record<string, string>;
  metaSnapshot: { xp: number; dayStreak: number; bestStreak: number; lastStudyDate: string; day: DayStat | null };
}): OutboxOp[] {
  const now = Date.now();
  const rnd = () => newOpId();
  const ops: OutboxOp[] = [];
  const byId = new Map(args.allCards.map((c) => [c.id, c]));
  for (const id of [...new Set(args.deletes)]) ops.push({ opId: rnd(), ts: now, type: 'delete-card', id });
  for (const [cardId, dataUrl] of Object.entries(args.pendingPhotos ?? {})) {
    ops.push({ opId: rnd(), ts: now, type: 'photo', cardId, dataUrl });
  }
  for (const id of [...new Set(args.cards)]) {
    const c = byId.get(id);
    if (c) ops.push({ opId: rnd(), ts: now, type: 'upsert-card', card: c });
  }
  if (args.meta && args.metaSnapshot.day) {
    ops.push({
      opId: rnd(), ts: now, type: 'meta',
      xp: args.metaSnapshot.xp, dayStreak: args.metaSnapshot.dayStreak,
      bestStreak: args.metaSnapshot.bestStreak, lastStudyDate: args.metaSnapshot.lastStudyDate,
      day: args.metaSnapshot.day,
    });
  }
  return coalesceOps(ops);
}
