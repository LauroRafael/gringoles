import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

const SEEN_KEY = 'gringoles-tutorial-seen';

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch { /* noop */ }
}

export function wasTutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

const EMOJIS = ['🃏', '🔝', '👆', '🔊', '📦', '🎯', '☁️'];

export default function TutorialModal() {
  const { showTutorial, setShowTutorial, lang } = useStore();
  const [step, setStep] = useState(0);
  const t = STRINGS[lang];

  if (!showTutorial) return null;

  const fill = (s: string) => s.replaceAll('{L}', t.pile_learning).replaceAll('{K}', t.pile_known);
  const steps = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    emoji: EMOJIS[n - 1],
    title: (t as Record<string, string>)[`tut_s${n}_t`],
    body: fill((t as Record<string, string>)[`tut_s${n}_b`]),
  }));
  const last = step === steps.length - 1;

  const close = () => {
    markTutorialSeen();
    setStep(0);
    setShowTutorial(false);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden animate-pop-in bg-white dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Faixa colorida */}
        <div className="bg-gradient-to-r from-sapphire via-carolina to-celadon px-5 pt-5 pb-4 text-white relative">
          <button onClick={close} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/25 hover:bg-black/40" title="Fechar">
            <X size={16} />
          </button>
          <p className="text-xs font-bold opacity-80">{t.tut_sub}</p>
          <h3 className="font-black text-xl">{t.tut_title}</h3>
          <p className="text-xs font-bold mt-1 opacity-80">{step + 1} {t.tut_dots} {steps.length}</p>
          <div className="flex gap-1.5 mt-2">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i === step ? 'bg-white' : i < step ? 'bg-white/60' : 'bg-black/25'}`} />
            ))}
          </div>
        </div>

        {/* Passo */}
        <div key={step} className="px-5 py-5 text-center animate-pop-in">
          <p className="text-6xl mb-3 animate-float">{steps[step].emoji}</p>
          <h4 className="font-black text-lg">{steps[step].title}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-2 leading-relaxed">{steps[step].body}</p>
        </div>

        {/* Navegação */}
        <div className="flex items-center gap-2 px-5 pb-5">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-white/10 text-sm font-bold disabled:opacity-30 active:scale-95"
          >
            <ChevronLeft size={16} /> {t.tut_back}
          </button>
          <button
            onClick={() => (last ? close() : setStep((s) => s + 1))}
            className="flex-1 inline-flex justify-center items-center gap-1 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-sapphire to-carolina text-white text-sm font-black active:scale-[0.98]"
          >
            {last ? <Sparkles size={16} /> : null} {last ? t.tut_start : t.tut_next} {!last && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
