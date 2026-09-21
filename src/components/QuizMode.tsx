import { useState } from 'react';
import { Volume2, Trophy, Shuffle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { speakEN } from '../lib/speech';
import { STRINGS } from '../lib/i18n';
import type { Card } from '../types';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Question {
  card: Card;
  options: string[];
}

/** Monta a rodada uma única vez: carta + 4 alternativas (1 certa + 3 distratoras). */
function buildRound(all: Card[]): Question[] {
  return shuffle(all)
    .slice(0, Math.min(10, all.length))
    .map((card) => {
      const distractors = shuffle(all.filter((c) => c.id !== card.id))
        .slice(0, 3)
        .map((c) => c.pt);
      return { card, options: shuffle([card.pt, ...distractors]) };
    });
}

export default function QuizMode() {
  const { answer, lang } = useStore();
  const t = STRINGS[lang];
  // Snapshot da rodada: responder atualiza a loja (SRS/XP), mas a lista exibida não muda.
  const [questions, setQuestions] = useState<Question[]>(() => buildRound(useStore.getState().cards));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const current = questions[index];

  const newQuiz = () => {
    setQuestions(buildRound(useStore.getState().cards));
    setIndex(0);
    setScore(0);
    setPicked(null);
  };

  if (!current) {
    return (
      <div className="text-center py-14">
        <p className="text-6xl mb-3">🎯</p>
        <h2 className="font-black text-xl">{t.quiz_done}</h2>
        <p className="mt-2 inline-flex items-center gap-1 px-4 py-2 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-black">
          <Trophy size={16} /> {score} / {questions.length || 10} {t.quiz_points}
        </p>
        <div><button onClick={newQuiz} className="mt-4 px-5 py-2.5 rounded-2xl bg-sapphire text-white font-bold inline-flex items-center gap-1"><Shuffle size={16} /> {t.quiz_new}</button></div>
      </div>
    );
  }

  const { card, options } = current;

  const pick = (opt: string) => {
    if (picked) return;
    setPicked(opt);
    const hit = opt === card.pt;
    if (hit) setScore((s) => s + 1);
    answer(card.id, hit);
    window.setTimeout(() => {
      setPicked(null);
      setIndex((i) => i + 1);
    }, 900);
  };

  return (
    <div className="max-w-md mx-auto text-center">
      <p className="text-xs font-bold text-slate-500">{t.quiz_q} {index + 1} {t.quiz_of} {questions.length} · 🏆 {score} {t.quiz_pts}</p>
      <div className="mt-3 rounded-3xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-6">
        <span className="text-6xl">{card.emoji}</span>
        <h2 className="text-3xl font-black mt-2">{card.en}</h2>
        <p className="text-slate-500">"{card.phoneticBR}" · {card.ipa}</p>
        <button onClick={() => speakEN(card.en)} className="mt-2 inline-flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-xl bg-sapphire text-white"><Volume2 size={15} /> {t.deck_listen}</button>
        <p className="text-sm font-bold mt-4 mb-2 text-left">{t.quiz_what}</p>
        <div className="grid gap-2">
          {options.map((opt) => {
            const isRight = opt === card.pt;
            const isPicked = picked === opt;
            let cls = 'border-slate-200 dark:border-white/10 hover:border-carolina';
            if (picked && isRight) cls = 'bg-emerald-500 text-white border-emerald-500';
            else if (picked && isPicked) cls = 'bg-rose-500 text-white border-rose-500';
            return (
              <button key={opt} onClick={() => pick(opt)} className={`px-4 py-3 rounded-2xl border text-sm font-bold text-left transition active:scale-[0.98] ${cls}`}>
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
