import { useState } from 'react';
import { Volume2, Keyboard, Eye } from 'lucide-react';
import { useStore } from '../store/useStore';
import { playEN } from '../lib/speech';
import { STRINGS } from '../lib/i18n';
import type { Card } from '../types';

/** Congela a fila da sessão: responder atualiza a loja, mas a ordem exibida não muda. */
function buildQueue(all: Card[]): Card[] {
  return [...all].sort((a, b) => a.nextReviewAt - b.nextReviewAt).slice(0, 20);
}

export default function TypeMode() {
  const { answer, lang } = useStore();
  const t = STRINGS[lang];
  const [queue, setQueue] = useState<Card[]>(() => buildQueue(useStore.getState().cards));
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<'idle' | 'ok' | 'err'>('idle');
  const [showHint, setShowHint] = useState(false);
  const [rounds, setRounds] = useState(0);

  const current = queue[index];

  if (!current) return <p className="text-center py-10 text-slate-500">{t.type_empty}</p>;

  const advance = () => {
    setValue('');
    setFeedback('idle');
    setShowHint(false);
    if (index + 1 >= queue.length) {
      // Fim da fila: monta sessão nova com o estado mais recente da loja.
      setQueue(buildQueue(useStore.getState().cards));
      setIndex(0);
      setRounds((r) => r + 1);
    } else {
      setIndex((i) => i + 1);
    }
  };

  const check = () => {
    if (!value.trim() || feedback !== 'idle') return;
    const ok = value.trim().toLowerCase() === current.en.trim().toLowerCase();
    setFeedback(ok ? 'ok' : 'err');
    answer(current.id, ok);
    if (ok) {
      window.setTimeout(advance, 800);
    }
  };

  return (
    <div className="max-w-md mx-auto text-center">
      <p className="text-xs font-bold text-slate-500 inline-flex items-center gap-1"><Keyboard size={14} /> {t.type_title} · {index + 1}/{queue.length}{rounds > 0 ? ` · ${t.type_session} ${rounds + 1}` : ''}</p>
      <div className={`mt-3 rounded-3xl border p-6 bg-white dark:bg-white/5 ${feedback === 'ok' ? 'border-emerald-500' : feedback === 'err' ? 'border-rose-500' : 'border-slate-200 dark:border-white/10'}`}>
        <span className="text-6xl">{current.emoji}</span>
        <p className="font-black text-xl mt-2">{current.pt}</p>
        <p className="text-sm text-slate-500">{showHint ? `"${current.phoneticBR}" · ${current.ipa}` : t.type_hint_hidden}</p>
        <div className="flex gap-2 justify-center mt-3">
          <button onClick={() => playEN(current.en)} className="inline-flex items-center gap-1 px-4 py-2.5 rounded-2xl bg-sapphire text-white text-sm font-bold"><Volume2 size={16} /> {t.deck_listen} 🔊</button>
          <button onClick={() => playEN(current.en, true)} className="px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-white/10 text-sm font-bold">{t.type_slow}</button>
          <button onClick={() => setShowHint((s) => !s)} className="px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-white/10 text-sm font-bold"><Eye size={16} /></button>
        </div>
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setFeedback('idle'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
          placeholder={t.type_ph}
          autoFocus
          className={`mt-4 w-full px-4 py-3 rounded-2xl border text-center text-lg font-bold outline-none bg-transparent ${feedback === 'ok' ? 'border-emerald-500 text-emerald-500' : feedback === 'err' ? 'border-rose-500 text-rose-500' : 'border-slate-200 dark:border-white/10'}`}
        />
        {feedback === 'ok' && <p className="mt-2 text-emerald-500 font-black">{t.type_ok}</p>}
        {feedback === 'err' && <p className="mt-2 text-rose-500 font-bold">{t.type_err} <b>{current.en}</b>. {t.type_err_end}</p>}
        <button onClick={check} className="mt-3 w-full py-3 rounded-2xl bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-black active:scale-[0.98]">{t.type_verify}</button>
      </div>
    </div>
  );
}
