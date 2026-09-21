import type { Card } from '../types';

/** Normaliza para comparação: minúsculas, sem espaços extras. */
export function normalizeEN(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function findDuplicate(cards: Card[], en: string, ignoreId?: string): Card | undefined {
  const needle = normalizeEN(en);
  if (!needle) return undefined;
  return cards.find((c) => normalizeEN(c.en) === needle && c.id !== ignoreId);
}

/** Separa um lote em { novas, duplicadas } contra o acervo + dentro do próprio lote. */
export function splitNewVsDuplicates<T extends { en: string }>(
  existing: Card[],
  batch: T[],
): { fresh: T[]; dups: T[] } {
  const seen = new Set(existing.map((c) => normalizeEN(c.en)));
  const fresh: T[] = [];
  const dups: T[] = [];
  for (const item of batch) {
    const key = normalizeEN(item.en);
    if (!key || seen.has(key)) {
      dups.push(item);
    } else {
      seen.add(key);
      fresh.push(item);
    }
  }
  return { fresh, dups };
}
