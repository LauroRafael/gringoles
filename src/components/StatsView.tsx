import { useState } from 'react';
import { Flame, Zap, Target, RotateCcw, CalendarPlus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';
import { storageUsage } from '../lib/image';
import { WORD_BANK } from '../data/bank';
import { normalizeEN } from '../lib/dedupe';

export default function StatsView() {
  const { cards, xp, dayStreak, bestStreak, stats, resetDemo, topUpNow, lang } = useStore();
  const t = STRINGS[lang];
  const [topUpMsg, setTopUpMsg] = useState<string | null>(null);
  const storage = storageUsage();
  const safeCards = Array.isArray(cards) ? cards : [];
  const safeStats = Array.isArray(stats) ? stats : [];
  const usedEN = new Set(safeCards.map((c) => normalizeEN(String(c.en ?? ''))));
  const bankLeft = WORD_BANK.filter((e) => !usedEN.has(normalizeEN(e.en))).length;
  const total = safeCards.length;
  const known = safeCards.filter((c) => c.pile === 'mastered').length;
  const pct = total ? Math.round((known / total) * 100) : 0;
  const level = Math.floor(xp / 100) + 1;
  const levelPct = xp % 100;

  const max = Math.max(1, ...safeStats.map((s) => s.studied));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-3xl p-5 bg-gradient-to-br from-sapphire to-carolina text-white">
        <p className="text-sm font-bold opacity-80 inline-flex items-center gap-1"><Zap size={14} /> {t.stats_level} {level} · {xp} XP</p>
        <div className="h-3 rounded-full bg-black/25 mt-2 overflow-hidden"><div className="h-full bg-white/90 rounded-full transition-all" style={{ width: `${levelPct}%` }} /></div>
        <p className="text-xs mt-1 opacity-80">{t.stats_next} {100 - levelPct} {t.stats_next_end}</p>
        <div className="flex gap-4 mt-4">
          <div><p className="text-2xl font-black inline-flex items-center gap-1"><Flame size={20} />{dayStreak}</p><p className="text-xs opacity-80">{t.stats_streak} {bestStreak})</p></div>
          <div><p className="text-2xl font-black inline-flex items-center gap-1"><Target size={20} />{pct}%</p><p className="text-xs opacity-80">{known}/{total} {t.stats_mastered}</p></div>
        </div>
      </div>

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <p className="font-black text-sm mb-3">{t.stats_days}</p>
        {safeStats.length === 0 && <p className="text-sm text-slate-500">{t.stats_days_empty}</p>}
        <div className="flex items-end gap-1.5 h-28">
          {safeStats.slice(-14).map((s) => (
            <div key={s.date} className="flex-1 flex flex-col items-center gap-1" title={`${s.date}: ${s.studied} ${t.stats_studied}`}>
              <div className="w-full rounded-lg bg-gradient-to-t from-sapphire to-carolina" style={{ height: `${Math.max(6, (s.studied / max) * 90)}px` }} />
              <span className="text-[9px] text-slate-400 font-bold">{String(s.date ?? '').slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 md:col-span-2">
        <p className="font-black text-sm mb-2">{t.stats_batch}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            onClick={() => {
              setTopUpMsg(t.stats_searching);
              void topUpNow().then((n) => {
                setTopUpMsg(n > 0 ? `+${n} ${t.stats_topup_done}` : bankLeft > 0 ? t.stats_batch_done : t.stats_bank_out);
                window.setTimeout(() => setTopUpMsg(null), 5000);
              });
            }}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sapphire text-white text-xs font-black active:scale-95"
          >
            <CalendarPlus size={13} /> {t.stats_topup}
          </button>
          {topUpMsg && <span className="text-xs font-bold text-sapphire dark:text-carolina">{topUpMsg}</span>}
          <span className="text-xs text-slate-500">{t.stats_bank_left} {bankLeft} {t.stats_bank_left_mid} {WORD_BANK.length} {t.stats_bank_left_end}</span>
          <button onClick={() => { if (confirm(t.stats_restore_confirm)) resetDemo(); }} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-500/10 text-rose-500 text-xs font-black">
            <RotateCcw size={13} /> {t.stats_restore}
          </button>
          <div className="w-full">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500">
              <span>💾 {t.stats_storage} {storage.usedKB} KB (~{storage.pct}% de ~5MB)</span>
              {storage.pct >= 80 && <span className="text-amber-600 dark:text-amber-300">{t.stats_almost}</span>}
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 mt-1 overflow-hidden">
              <div className={`h-full rounded-full ${storage.pct >= 80 ? 'bg-amber-500' : 'bg-gradient-to-r from-sapphire to-carolina'}`} style={{ width: `${storage.pct}%` }} />
            </div>
            <span className="text-xs text-slate-500">{t.stats_backup_hint}</span>
            <p className="text-center text-[11px] text-slate-400 mt-3">
              {t.stats_made} <a href="https://lartecnologia.com.br" target="_blank" rel="noreferrer" className="font-bold underline">Lauro Rafael</a> · LAR Tecnologia ·{' '}
              <a href="https://ko-fi.com/laurorafael" target="_blank" rel="noreferrer" className="font-bold underline">{t.stats_support}</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
