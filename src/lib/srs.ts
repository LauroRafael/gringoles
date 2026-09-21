/** Repetição espaçada estilo Leitner (simplificada e previsível). */
export const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 15, 30];

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
