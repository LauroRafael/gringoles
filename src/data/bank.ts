import type { Card } from '../types';
import { BANK_1, type BankEntry } from './bank1';
import { BANK_2 } from './bank2';
import { BANK_3 } from './bank3';
import { normalizeEN } from '../lib/dedupe';

export const WORD_BANK: (BankEntry & { bankId: string })[] = [...BANK_1, ...BANK_2, ...BANK_3].map(
  (e, i) => ({ ...e, bankId: `bank-${i}` }),
);

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

/**
 * Seleciona até `count` entradas do banco ainda não presentes no acervo
 * (por bankId importado antes ou por EN normalizado), em ordem do banco.
 */
export function pickDailyWords(existing: Card[], count: number): (BankEntry & { bankId: string })[] {
  const usedBankIds = new Set(
    existing.flatMap((c) => (c.bankId ? [c.bankId] : [])),
  );
  const usedEN = new Set(existing.map((c) => normalizeEN(c.en)));
  const picked: (BankEntry & { bankId: string })[] = [];
  for (const entry of WORD_BANK) {
    if (picked.length >= count) break;
    if (usedBankIds.has(entry.bankId)) continue;
    if (usedEN.has(normalizeEN(entry.en))) continue;
    usedEN.add(normalizeEN(entry.en));
    picked.push(entry);
  }
  return picked;
}

export function materializeBankEntry(
  entry: BankEntry & { bankId: string },
  index: number,
  now = Date.now(),
): Card {
  return {
    id: `auto-${entry.bankId}-${now}`,
    en: entry.en,
    pt: entry.pt,
    phoneticBR: entry.phoneticBR,
    ipa: entry.ipa,
    exampleEN: entry.exampleEN,
    examplePT: entry.examplePT,
    emoji: entry.emoji,
    gradient: GRADIENTS[(WORD_BANK.indexOf(entry) + index) % GRADIENTS.length],
    category: entry.category,
    pile: 'new',
    box: 0,
    nextReviewAt: now,
    correctStreak: 0,
    seenCount: 0,
    createdAt: now + index,
    bankId: entry.bankId,
  };
}

export function bankRemaining(existing: Card[]): number {
  const usedEN = new Set(existing.map((c) => normalizeEN(c.en)));
  return WORD_BANK.filter((e) => !usedEN.has(normalizeEN(e.en))).length;
}
