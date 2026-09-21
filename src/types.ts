export type Pile = 'new' | 'learning' | 'known';

export interface Card {
  id: string;
  en: string;
  pt: string;
  /** Pronúncia aportuguesada, ex: "uóra" */
  phoneticBR: string;
  /** Alfabeto fonético internacional, ex: /ˈwɔːtər/ */
  ipa: string;
  exampleEN: string;
  examplePT: string;
  emoji: string;
  /** Foto enviada pelo usuário (dataURL). Se vazio, usa emoji + gradiente. */
  photo?: string;
  /** URL da foto no Storage (modo full). Tem prioridade sobre `photo`. */
  photoUrl?: string;
  gradient: string;
  category: string;
  pile: Pile;
  /** Caixa Leitner 0..5 */
  box: number;
  nextReviewAt: number;
  correctStreak: number;
  seenCount: number;
  createdAt: number;
  lastSeenAt?: number;
  /** ID da entrada no banco curado (quando a palavra veio do automático). */
  bankId?: string;
}

export type Tab = 'study' | 'library' | 'quiz' | 'type' | 'stats' | 'admin';

export interface DayStat {
  date: string; // yyyy-mm-dd
  studied: number;
  known: number;
}
