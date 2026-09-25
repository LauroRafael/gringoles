/** Repetição espaçada (SRS) em 5 caixas: Novas→Checar→Estudar→Praticar→Dominado.
 * Acertou avança 1, errou volta 1. A repetição acontece percorrendo as caixas. */
export const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 15];

export const BOX_PILES = ['new', 'check', 'study', 'practice', 'mastered'] as const;

export function boxToPile(box: number): (typeof BOX_PILES)[number] {
  const clamped = Math.max(0, Math.min(BOX_PILES.length - 1, box));
  return BOX_PILES[clamped];
}

export function pileToBox(pile: string): number {
  const idx = (BOX_PILES as readonly string[]).indexOf(pile);
  return idx >= 0 ? idx : 0;
}

/** Normaliza piles legadas (learning→practice, known→mastered, due→study). */
export function normalizePile(pile: string): (typeof BOX_PILES)[number] {
  if (pile === 'learning') return 'practice';
  if (pile === 'known') return 'mastered';
  if (pile === 'due') return 'study';
  const idx = (BOX_PILES as readonly string[]).indexOf(pile);
  return (idx >= 0 ? BOX_PILES[idx] : 'new') as (typeof BOX_PILES)[number];
}

export function nextReviewForBox(box: number, now = Date.now()): number {
  const clamped = Math.max(0, Math.min(BOX_INTERVALS_DAYS.length - 1, box));
  const days = BOX_INTERVALS_DAYS[clamped];
  return now + days * 24 * 60 * 60 * 1000;
}

export function isDue(nextReviewAt: number, now = Date.now()): boolean {
  return nextReviewAt <= now;
}

export function dueLabel(nextReviewAt: number, now = Date.now(), lang: 'pt' | 'en' = 'pt'): string {
  if (lang === 'en') {
    if (nextReviewAt <= now) return 'review now';
    const days = Math.ceil((nextReviewAt - now) / (24 * 60 * 60 * 1000));
    if (days <= 1) return 'tomorrow';
    return `in ${days} days`;
  }
  if (nextReviewAt <= now) return 'revisar agora';
  const diffMs = nextReviewAt - now;
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'revisar agora';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
}
