import { useEffect, useRef, useState } from 'react';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

interface Props {
  value: string;
  onPick: (emoji: string) => void;
}

/**
 * Botão de emoji com biblioteca vasta (~1800) + busca, em popover.
 * Usa o Picker vanilla do emoji-mart (o wrapper React não suporta React 19).
 */
export default function EmojiPicker({ value, onPick }: Props) {
  const { theme, lang } = useStore();
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !hostRef.current) return;
    hostRef.current.innerHTML = '';
    const picker = new Picker({
      data,
      theme: theme === 'dark' ? 'dark' : 'light',
      locale: 'en',
      previewPosition: 'none',
      skinTonePosition: 'none',
      maxFrequentRows: 2,
      perLine: 8,
      onEmojiSelect: (e: { native?: string }) => {
        if (e.native) {
          onPick(e.native);
          setOpen(false);
        }
      },
    });
    hostRef.current.appendChild(picker as unknown as Node);
  }, [open, theme, onPick]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open ]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={STRINGS[lang].lib_emoji_title}
        className="text-3xl p-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:scale-110 active:scale-95 transition"
      >
        {value || '📚'} <span className="text-xs align-middle">🔍</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-2 left-0 shadow-2xl rounded-2xl overflow-hidden animate-pop-in">
          <div ref={hostRef} className="[&em-emoji-picker]:h-[320px] [&em-emoji-picker]:w-[320px]" />
          <p className="text-[10px] text-center py-1 bg-white dark:bg-slate-900 text-slate-400 font-bold">{lang === 'pt' ? 'busca em inglês: cat, food, happy...' : 'search in English: cat, food, happy...'}</p>
        </div>
      )}
    </div>
  );
}
