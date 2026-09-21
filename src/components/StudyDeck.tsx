import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, Eye, RotateCcw, Volume2, Turtle, X, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { speakEN, speakPT, speakExamplePair, stopSpeak } from '../lib/speech';
import { STRINGS } from '../lib/i18n';
import { dueLabel } from '../lib/srs';
import type { Card } from '../types';

function visiblePhoto(c: Card): string | undefined {
  if (c.photoUrl && c.photoUrl.length > 0) return c.photoUrl;
  return c.photo && c.photo.length > 0 ? c.photo : undefined;
}

export default function StudyDeck() {
  const { cards, pileFilter, answer, movePile, newPerDay, setTab, setPileFilter, labelLearning, labelKnown, lang } = useStore();
  const t = STRINGS[lang];
  const pileName = (p: string) =>
    p === 'new' ? t.pill_new : p === 'known' ? labelKnown : p === 'learning' ? labelLearning : p === 'due' ? t.pile_study : t.pile_all;
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  const [sessionCount, setSessionCount] = useState(0);

  const queue = useMemo(() => {
    const now = Date.now();
    let list = [...cards].sort((a, b) => a.nextReviewAt - b.nextReviewAt || a.createdAt - b.createdAt);
    if (pileFilter === 'due') list = list.filter((c) => c.nextReviewAt <= now);
    else if (pileFilter !== 'all') list = list.filter((c) => c.pile === pileFilter);
    else {
      // Fila inteligente: vencidas primeiro + até N novas
      const due = list.filter((c) => c.nextReviewAt <= now && c.pile !== 'new');
      const news = list.filter((c) => c.pile === 'new').slice(0, newPerDay);
      const rest = list.filter((c) => c.nextReviewAt <= now && c.pile === 'new').slice(newPerDay);
      list = [...due, ...news, ...rest];
    }
    return list;
  }, [cards, pileFilter, newPerDay]);

  const current: Card | undefined = queue[0];

  const respondingRef = useRef(false);
  const respond = (known: boolean) => {
    if (!current || leaving || respondingRef.current) return;
    respondingRef.current = true;
    stopSpeak();
    setLeaving(known ? 'right' : 'left');
    window.setTimeout(() => {
      answer(current.id, known);
      setFlipped(false);
      setLeaving(null);
      respondingRef.current = false;
      setSessionCount((n) => n + 1);
    }, 220);
  };

  // Atalhos de teclado ← → espaço (useEffect com cleanup real — useMemo aqui acumulava listeners)
  const respondRef = useRef(respond);
  respondRef.current = respond;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') respondRef.current(false);
      else if (e.key === 'ArrowRight') respondRef.current(true);
      else if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!current) {
    return (
      <div className="text-center py-16 animate-pop-in">
        <div className="text-7xl mb-4">🎉</div>
        <h2 className="text-2xl font-black">{t.deck_done}</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto">
          {t.deck_done_sub}
        </p>
        <div className="flex gap-2 justify-center mt-6 flex-wrap">
          <button onClick={() => { setPileFilter('all'); }} className="px-4 py-2 rounded-xl bg-sapphire text-white font-bold hover:bg-celadon">{t.deck_view_all}</button>
          <button onClick={() => setTab('library')} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-bold">{t.deck_add}</button>
          <button onClick={() => setTab('quiz')} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-bold">{t.deck_quiz}</button>
        </div>
        {sessionCount > 0 && <p className="mt-4 text-sm text-emerald-500 font-bold">+{sessionCount} {t.deck_session}</p>}
      </div>
    );
  }

  const photo = visiblePhoto(current);

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
        <span>{queue.length} {t.deck_in_queue} {pileFilter !== 'all' ? `· ${t.deck_filter}: ${pileName(pileFilter)}` : `· ${t.deck_smart}`}</span>
        <span className="inline-flex items-center gap-1">⏱ {dueLabel(current.nextReviewAt, Date.now(), lang)} · 📦 caixa {current.box}/5</span>
      </div>
      {current.pile !== 'known' && (
        <div className="mb-2 px-3 py-2 rounded-2xl bg-azure dark:bg-carolina/10 border border-celadon dark:border-carolina/20">
          <div className="flex items-center justify-between text-[11px] font-bold text-sapphire dark:text-carolina">
            <span>📦 Caixa {current.box} {t.deck_box_of} {labelKnown}</span>
            <span>{current.box >= 3 ? t.deck_ready : `${t.deck_missing} ${3 - current.box} ${t.deck_missing_end}`}</span>
          </div>
          <div className="h-1.5 rounded-full bg-carolina/20 dark:bg-white/10 mt-1.5 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-sapphire to-carolina transition-all" style={{ width: `${Math.min(100, (current.box / 3) * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="relative h-[380px] sm:h-[480px]">
        {/* Próximo card (fundo) */}
        {queue[1] && (
          <div className="absolute inset-0 scale-[0.96] translate-y-3 opacity-60 rounded-3xl bg-slate-200 dark:bg-white/5 border border-slate-200 dark:border-white/10" />
        )}

        <AnimatePresence mode="popLayout">
          <motion.div
            key={current.id}
            className="absolute inset-0"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.9}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) respond(true);
              else if (info.offset.x < -100) respond(false);
            }}
            animate={
              leaving === 'right'
                ? { x: 400, rotate: 20, opacity: 0 }
                : leaving === 'left'
                  ? { x: -400, rotate: -20, opacity: 0 }
                  : { x: 0, rotate: 0, opacity: 1 }
            }
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div
              className="perspective-1000 h-full cursor-pointer select-none"
              onClick={() => setFlipped((f) => !f)}
            >
              <div className={`relative w-full h-full transition-transform duration-500 preserve-3d ${flipped ? 'rotate-y-180' : ''}`}>
                {/* FRENTE (EN) */}
                <div className="absolute inset-0 backface-hidden rounded-3xl overflow-hidden shadow-2xl border border-white/20">
                  <div className={`h-36 sm:h-56 bg-gradient-to-br ${current.gradient} flex items-center justify-center relative overflow-hidden`}>
                    {photo ? (
                      <>
                        <img src={photo} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60" />
                        <img src={photo} alt={current.en} className="relative max-w-full max-h-full object-contain drop-shadow-lg" />
                      </>
                    ) : (
                      <span className="text-6xl sm:text-8xl drop-shadow-lg">{current.emoji}</span>
                    )}
                    <span className="absolute top-3 left-3 text-xs font-black px-2 py-1 rounded-full bg-black/40 text-white">{current.category}</span>
                    <span className="absolute top-3 right-3 text-xs font-black px-2 py-1 rounded-full bg-black/40 text-white">
                      {current.pile === 'new' ? '✨ Nova' : current.pile === 'known' ? `✅ ${labelKnown}` : `📚 ${labelLearning}`}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 h-[calc(100%-9rem)] sm:h-[calc(100%-14rem)] p-3 sm:p-5 flex flex-col items-center justify-center text-center gap-1.5 sm:gap-2">
                    <p className="text-[10px] sm:text-xs font-bold tracking-widest text-celadon">{t.deck_front}</p>
                    <h2 className="text-3xl sm:text-4xl font-black">{current.en}</h2>
                    <p className="text-lg text-slate-500 dark:text-slate-300">🗣️ "{current.phoneticBR}"</p>
                    <p className="text-sm font-mono text-slate-400">{current.ipa}</p>
                    <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => speakEN(current.en)} title={t.deck_listen_title} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sapphire text-white text-sm font-bold hover:bg-celadon active:scale-95">
                        <Volume2 size={16} /> {t.deck_listen}
                      </button>
                      <button onClick={() => speakEN(current.en, true)} title={t.deck_slow_title} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-bold active:scale-95">
                        <Turtle size={16} /> {t.deck_slow}
                      </button>
                    </div>
                  </div>
                </div>

                {/* VERSO (PT) */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-3xl overflow-hidden shadow-2xl border border-white/20 bg-gradient-to-br from-prussian via-[#0e2a44] to-sapphire text-white p-4 sm:p-6 flex flex-col items-center justify-center text-center gap-1.5 sm:gap-2">
                  <p className="text-xs font-bold tracking-widest text-azure">{t.deck_back}</p>
                  <h2 className="text-3xl font-black">{current.pt}</h2>
                  <div className="bg-white/10 rounded-2xl p-3 mt-2 w-full">
                    <p className="text-sm italic">"{current.exampleEN}"</p>
                    <p className="text-sm text-slate-300 mt-1">{current.examplePT}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => speakExamplePair(current.exampleEN, current.examplePT)}
                      title={t.deck_ex_both_title}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white text-slate-900 text-sm font-black hover:bg-slate-100 active:scale-95"
                    >
                      <Volume2 size={16} /> {t.deck_ex_both}
                    </button>
                    <button
                      onClick={() => speakEN(current.exampleEN)}
                      title={t.deck_ex_en}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white/15 text-sm font-bold active:scale-95"
                    >
                      🇺🇸 EN
                    </button>
                    <button
                      onClick={() => speakPT(current.examplePT)}
                      title={t.deck_ex_pt}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white/15 text-sm font-bold active:scale-95"
                    >
                      🇧🇷 PT
                    </button>
                    <button
                      onClick={() => stopSpeak()}
                      title={t.deck_stop}
                      className="px-3 py-2 rounded-xl bg-white/10 text-sm font-bold active:scale-95"
                    >
                      ⏹
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Carimbos Tinder */}
        {leaving === 'right' && (
          <div className="absolute top-6 right-4 rotate-12 px-4 py-2 rounded-xl border-4 border-emerald-400 text-emerald-400 font-black text-2xl bg-white/80">{labelKnown.toUpperCase()}! ✓</div>
        )}
        {leaving === 'left' && (
          <div className="absolute top-6 left-4 -rotate-12 px-4 py-2 rounded-xl border-4 border-rose-500 text-rose-500 font-black text-2xl bg-white/80">{labelLearning.toUpperCase()} ✗</div>
        )}
      </div>

      {/* Botões Tinder */}
      <div className="flex items-center justify-center gap-3 sm:gap-4 mt-3 sm:mt-4">
        <button
          onClick={() => respond(false)}
          className="group w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/40 flex items-center justify-center hover:scale-110 active:scale-90 transition"
          title={`${labelLearning} (←)`}
        >
          <X size={26} strokeWidth={3} />
        </button>
        <button
          onClick={() => setFlipped((f) => !f)}
          className="px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-sm font-bold inline-flex items-center gap-1 active:scale-95"
          title={t.deck_turn_title}
        >
          <Eye size={16} /> {t.deck_turn}
        </button>
        <button
          onClick={() => respond(true)}
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 flex items-center justify-center hover:scale-110 active:scale-90 transition"
          title={`${labelKnown} (→)`}
        >
          <Check size={26} strokeWidth={3} />
        </button>
      </div>
      <div className="flex items-center justify-center gap-3 mt-2 sm:mt-3 text-[11px] sm:text-xs">
        <span className="inline-flex items-center gap-1 text-rose-500 font-bold"><X size={12} /> {labelLearning} · {t.deck_fixes}</span>
        <span className="inline-flex items-center gap-1 text-emerald-500 font-bold"><BadgeCheck size={12} /> {labelKnown} · {t.deck_sleeps}</span>
      </div>

      {/* Rebaixar mesmo se souber (só desktop — no mobile o ✗ já rebaixa) */}
      <div className="mt-2 sm:mt-4 p-2 sm:p-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 hidden sm:flex items-center justify-between gap-2">
        <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold">{t.deck_rebox} <b>{labelLearning}</b>:</p>
        <button
          onClick={() => movePile(current.id, 'learning')}
          className="inline-flex items-center gap-1 text-xs font-black px-3 py-2 rounded-xl bg-amber-500 text-white hover:bg-amber-400 active:scale-95 whitespace-nowrap"
        >
          <RotateCcw size={14} /> Rever
        </button>
      </div>
    </div>
  );
}
