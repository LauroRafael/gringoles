import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

/** Distância do arrasto (com resistência) que dispara a atualização. */
const THRESHOLD = 70;
/** Teto visual do indicador. */
const MAX_PULL = 120;

/**
 * Pull-to-refresh customizado: arrastar para baixo no topo da tela sincroniza
 * (descarrega a fila offline + busca o lote diário). Listeners passivos —
 * nunca bloqueiam o scroll nem os swipes dos cards.
 */
export default function PullToRefresh() {
  const lang = useStore((s) => s.lang);
  const modalsOpen = useStore((s) =>
    s.showAuth || s.showInvite || s.showTutorial || s.showProfile || s.mustChangePassword,
  );
  const t = STRINGS[lang];
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);
  const resultTimer = useRef<number | undefined>(undefined);
  const modalsOpenRef = useRef(modalsOpen);
  const refreshingRef = useRef(refreshing);

  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);
  useEffect(() => {
    modalsOpenRef.current = modalsOpen;
    if (modalsOpen) setPull(0);
  }, [modalsOpen]);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => () => {
    if (resultTimer.current !== undefined) window.clearTimeout(resultTimer.current);
  }, []);

  const doRefresh = async () => {
    if (refreshingRef.current) return;
    setRefreshing(true);
    setResult(null);
    try {
      await useStore.getState().flushOutbox(true).catch(() => {});
      const n = await useStore.getState().ensureDailyWords().catch(() => 0);
      const tt = STRINGS[useStore.getState().lang];
      setResult(n > 0 ? `🎉 ${n} ${tt.ptr_new}` : `✓ ${tt.ptr_ok}`);
    } finally {
      setRefreshing(false);
      setPull(0);
      if (resultTimer.current !== undefined) window.clearTimeout(resultTimer.current);
      resultTimer.current = window.setTimeout(() => setResult(null), 2500);
    }
  };
  const doRefreshRef = useRef(doRefresh);
  useEffect(() => {
    doRefreshRef.current = doRefresh;
  });

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        startRef.current = null;
        return;
      }
      const t0 = e.touches[0];
      startRef.current = { x: t0.clientX, y: t0.clientY };
    };
    const onMove = (e: TouchEvent) => {
      const s = startRef.current;
      if (!s || e.touches.length !== 1) return;
      if (modalsOpenRef.current || refreshingRef.current) return;
      // Só no topo absoluto da página (senão é scroll normal).
      if (window.scrollY > 0) {
        startRef.current = null;
        return;
      }
      const t0 = e.touches[0];
      const dx = t0.clientX - s.x;
      const dy = t0.clientY - s.y;
      // Vertical dominante e para baixo (swipe horizontal dos cards não entra).
      if (dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        setPull(Math.min(dy * 0.5, MAX_PULL));
      } else if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
        startRef.current = null;
        setPull(0);
      }
    };
    const onEnd = () => {
      startRef.current = null;
      if (pullRef.current >= THRESHOLD && !refreshingRef.current && !modalsOpenRef.current) {
        void doRefreshRef.current();
      } else {
        setPull(0);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!refreshing && pull <= 8 && !result) return null;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 flex flex-col items-center pointer-events-none select-none pt-[env(safe-area-inset-top)]">
        {(refreshing || pull > 8) && (
          <div
            className="mt-3 w-10 h-10 rounded-full bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-white/10 flex items-center justify-center"
            style={{
              transform: refreshing ? undefined : `scale(${0.6 + 0.4 * progress})`,
              opacity: refreshing ? 1 : 0.4 + 0.6 * progress,
            }}
          >
            {refreshing ? (
              <Loader2 size={20} className="animate-spin text-celadon" />
            ) : (
              <ArrowDown
                size={20}
                className="text-sapphire dark:text-carolina transition-transform"
                style={{ transform: `rotate(${progress >= 1 ? 180 : 0}deg)` }}
              />
            )}
          </div>
        )}
        {!refreshing && !result && pull > 8 && (
          <div className="mt-1.5 text-[11px] font-black text-slate-500 dark:text-slate-300 drop-shadow">
            {progress >= 1 ? t.ptr_release : t.ptr_pull}
          </div>
        )}
      </div>
      {result && (
        <div className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none select-none bottom-[calc(6.5rem+env(safe-area-inset-bottom))]">
          <div className="px-4 py-2 rounded-full bg-slate-900/90 dark:bg-white/90 text-white dark:text-slate-900 text-xs font-black shadow-xl animate-toast-up">
            {result.includes('✓') ? <span className="inline-flex items-center gap-1"><Check size={13} />{result.replace('✓ ', '')}</span> : result}
          </div>
        </div>
      )}
    </>
  );
}
