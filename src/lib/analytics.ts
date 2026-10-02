import { supabase } from './supabase';

/**
 * Monitor de acessos (first-party, sem cookie de terceiros e sem IP).
 * Cada abertura do app grava 1 linha em `public.visits` — inclusive de quem
 * nunca criou conta. O `visitor_id` é um id anônimo no localStorage.
 */

const VISITOR_KEY = 'gringoles-visitor-id';
const LAST_LOG_KEY = 'gringoles-last-visit-log';
/** Intervalo mínimo entre logs do mesmo aparelho (evita spam em reload). */
const THROTTLE_MS = 30 * 60 * 1000;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Id anônimo e persistente deste aparelho/navegador. */
export function getVisitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = newId();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return newId();
  }
}

/**
 * Registra a visita (fire-and-forget, nunca quebra o app).
 * @param userId id do usuário logado, ou null (visitante sem conta).
 * @param lang idioma atual da interface.
 */
export function logVisit(userId: string | null, lang: string): void {
  try {
    if (!supabase) return;
    // ?nolog=1 pula (testes/screenshots não poluem o monitor).
    try {
      if (new URLSearchParams(window.location.search).has('nolog')) return;
    } catch { /* noop */ }
    const now = Date.now();
    const last = Number(localStorage.getItem(LAST_LOG_KEY) ?? 0) || 0;
    if (now - last < THROTTLE_MS) return;
    try {
      localStorage.setItem(LAST_LOG_KEY, String(now));
    } catch { /* noop */ }
    const ref = (() => {
      try {
        const r = document.referrer || '';
        // Só guarda origem externa (mesmo site não interessa).
        if (r && !r.startsWith(window.location.origin)) return r.slice(0, 300);
        return '';
      } catch {
        return '';
      }
    })();
    const ua = (() => {
      try {
        return (navigator.userAgent || '').slice(0, 200);
      } catch {
        return '';
      }
    })();
    void (async () => {
      try {
        const { error } = await supabase.from('visits').insert({
          visitor_id: getVisitorId(),
          user_id: userId,
          lang,
          referrer: ref,
          user_agent: ua,
        });
        // Rejeitou (RLS/offline)? Libera o throttle p/ tentar de novo depois.
        if (error) throw error;
      } catch {
        try {
          localStorage.setItem(LAST_LOG_KEY, String(last));
        } catch { /* noop */ }
      }
    })();
  } catch { /* monitor nunca quebra o app */ }
}
