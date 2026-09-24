import { useState } from 'react';
import { Volume2, Trophy, Shuffle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { playEN } from '../lib/audio';
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

const BLANK_RATIO = 0.4;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface Question {
  card: Card;
  kind: 'choice' | 'blank';
  options: string[];
  blanked?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Frase com a palavra oculta, ou null quando o exemplo não contém a palavra. */
function makeBlank(card: Card): string | null {
  const ex = (card.exampleEN || '').trim();
  const phrase = (card.en || '').trim();
  if (!ex || !phrase) return null;
  const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
  if (!re.test(ex)) return null;
  return ex.replace(re, '_____');
}

/** Distratoras EN únicas (exclui a certa e repetidas). */
function pickEnDistractors(all: Card[], card: Card, n: number): string[] {
  const out: string[] = [];
  const seen = new Set([norm(card.en)]);
  for (const c of shuffle(all)) {
    if (c.id === card.id) continue;
    const k = norm(c.en);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c.en);
    if (out.length >= n) break;
  }
  return out;
}

/** Monta a rodada uma única vez: ~40% vira "complete a frase", o resto é EN→PT clássico. */
function buildRound(all: Card[]): Question[] {
  return shuffle(all)
    .slice(0, Math.min(10, all.length))
    .map((card): Question => {
      if (Math.random() < BLANK_RATIO) {
        const blanked = makeBlank(card);
        const distractors = blanked ? pickEnDistractors(all, card, 3) : [];
        if (blanked && distractors.length >= 3) {
          return { card, kind: 'blank', options: shuffle([card.en, ...distractors]), blanked };
        }
      }
      const distractors = shuffle(all.filter((c) => c.id !== card.id))
        .slice(0, 3)
        .map((c) => c.pt);
      return { card, kind: 'choice', options: shuffle([card.pt, ...distractors]) };
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
  const isBlank = current.kind === 'blank';
  const correct = isBlank ? card.en : card.pt;
  const hit = picked !== null && picked === correct;

  const pick = (opt: string) => {
    if (picked) return;
    setPicked(opt);
    const ok = opt === correct;
    if (ok) setScore((s) => s + 1);
    answer(card.id, ok);
    window.setTimeout(() => {
      setPicked(null);
      setIndex((i) => i + 1);
    }, 900);
  };

  return (
    <div className="max-w-md mx-auto text-center">
      <p className="text-xs font-bold text-slate-500">{t.quiz_q} {index + 1} {t.quiz_of} {questions.length} · 🏆 {score} {t.quiz_pts}</p>
      <div className="mt-3 rounded-3xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-6">
        {isBlank ? (
          <>
            <span className={`text-6xl inline-block ${hit ? '' : 'blur-lg select-none'}`}>{card.emoji}</span>
            <p className="text-xl font-bold leading-relaxed mt-2">
              {current.blanked!.split('_____').map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && <span className="text-sapphire dark:text-carolina font-black"> _____ </span>}
                </span>
              ))}
            </p>
            <p className="text-sm font-bold mt-4 mb-2 text-left">{t.quiz_complete}</p>
            <div className="grid gap-2">
              {options.map((opt) => {
                const isRight = opt === correct;
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
            {picked && <p className="mt-3 text-sm text-slate-500">"{card.examplePT}" · "{card.phoneticBR}"</p>}
          </>
        ) : (
          <>
            <span className="text-6xl">{card.emoji}</span>
            <h2 className="text-3xl font-black mt-2">{card.en}</h2>
            <p className="text-slate-500">"{card.phoneticBR}" · {card.ipa}</p>
            <button onClick={() => playEN(card.en)} className="mt-2 inline-flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-xl bg-sapphire text-white"><Volume2 size={15} /> {t.deck_listen}</button>
            <p className="text-sm font-bold mt-4 mb-2 text-left">{t.quiz_what}</p>
            <div className="grid gap-2">
              {options.map((opt) => {
                const isRight = opt === correct;
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
          </>
        )}
      </div>
    </div>
  );
}
