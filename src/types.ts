/** 5 caixas SRS: 0=Novas, 1=Checar, 2=Estudar, 3=Praticar, 4=Dominado */
export type Pile = 'new' | 'check' | 'study' | 'practice' | 'mastered';
/** Piles legadas (migração v4): learning→practice, known→mastered */
export type LegacyPile = 'new' | 'learning' | 'known';

export interface Card {
  id: string;
  en: string;
  pt: string;
  /** Pronúncia aportuguesada, ex: "uóra" */
  phoneticBR: string;
  /** Alfabeto fonético internacional, ex: /ˈwɔːtər/ */
  ipa: string;
  /** Frase de exemplo no PRESENTE simples (tempo principal — Quiz/áudio usam este). */
  exampleEN: string;
  examplePT: string;
  /** Frase de exemplo no PASSADO simples (opcional — '' = não tem). */
  examplePastEN?: string;
  examplePastPT?: string;
  /** Frase de exemplo no FUTURO simples (opcional — '' = não tem). */
  exampleFutureEN?: string;
  exampleFuturePT?: string;
  emoji: string;
  /** Foto enviada pelo usuário (dataURL). Se vazio, usa emoji + gradiente. */
  photo?: string;
  /** URL da foto no Storage (modo full). Tem prioridade sobre `photo`. */
  photoUrl?: string;
  gradient: string;
  category: string;
  pile: Pile;
  /** Caixa SRS 0..4 (0=Novas, 1=Checar, 2=Estudar, 3=Praticar, 4=Dominado) */
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
