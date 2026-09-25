import { BookOpen, Flame, Moon, Sparkles, Sun, Megaphone, CheckCircle2, Package, LogIn, LogOut, Cloud, FlaskConical, CircleHelp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';
import type { Pile } from '../types';

interface PileTab { key: Pile; label: string; icon: React.ReactNode; active: string; activeSoft: string }

export default function TopBar() {
  const { cards, pileFilter, setPileFilter, setTab, theme, toggleTheme, xp, dayStreak,
    user, role, signOut, setShowAuth, demoMax, lang, setLang, setShowTutorial, displayName } = useStore();
  const t = STRINGS[lang];
  const PILES: PileTab[] = [
    { key: 'new', label: t.pile_new, icon: <Sparkles size={16} />, active: 'bg-sky-500/80 border-sky-400/60 shadow-sky-500/25', activeSoft: 'bg-sky-500/80 border-sky-400/60' },
    { key: 'check', label: t.pile_check, icon: <CheckCircle2 size={16} />, active: 'bg-teal-500/80 border-teal-400/60 shadow-teal-500/25', activeSoft: 'bg-teal-500/80 border-teal-400/60' },
    { key: 'study', label: t.pile_study, icon: <BookOpen size={16} />, active: 'bg-sapphire/80 border-celadon/60 shadow-sapphire/25', activeSoft: 'bg-sapphire/80 border-celadon/60' },
    { key: 'practice', label: t.pile_practice, icon: <Megaphone size={16} />, active: 'bg-rose-500/80 border-rose-400/60 shadow-rose-500/25', activeSoft: 'bg-rose-500/80 border-rose-400/60' },
    { key: 'mastered', label: t.pile_mastered, icon: <Package size={16} />, active: 'bg-emerald-500/80 border-emerald-400/60 shadow-emerald-500/25', activeSoft: 'bg-emerald-500/80 border-emerald-400/60' },
  ];
  const counts: Record<Pile, number> = {
    new: cards.filter((c) => c.pile === 'new').length,
    check: cards.filter((c) => c.pile === 'check').length,
    study: cards.filter((c) => c.pile === 'study').length,
    practice: cards.filter((c) => c.pile === 'practice').length,
    mastered: cards.filter((c) => c.pile === 'mastered').length,
  };

  return (
    <>
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-white/10">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-1 sm:pt-4 pb-1 sm:pb-3">
          {/* Primeira dobra: logo + botões (mobile e desktop) */}
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <button onClick={() => { setPileFilter('new'); setTab('study'); }} className="flex flex-col items-end justify-center text-left shrink-0">
              <img src="/img/logo.png" alt="Gringolês" className="h-8 sm:h-10 object-contain dark:invert dark:hue-rotate-180" />
              <span className="hidden sm:block text-[10px] leading-tight font-medium text-slate-600 dark:text-slate-300">{t.top_subtitle}</span>
            </button>

            <div className="flex items-center gap-1 sm:gap-2 justify-end overflow-x-auto min-w-0 py-0.5">
              <span title="XP" className="shrink-0 hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                ⚡ {xp} XP
              </span>
              <span title={t.top_streak_title} className="shrink-0 hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                <Flame size={14} /> {dayStreak}
              </span>
              {!user ? (
                <span title={`${t.top_demo_title}: ${cards.length}/${demoMax} ${t.top_words}`} className="shrink-0 hidden sm:inline-flex items-center gap-1 whitespace-nowrap text-xs font-black px-2.5 py-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                  <FlaskConical size={12} /> DEMO {cards.length}/{demoMax}
                </span>
              ) : (
                <span title={role === 'admin' ? t.top_admin_title : t.top_full_title} className="shrink-0 hidden sm:inline-flex items-center gap-1 whitespace-nowrap text-xs font-black px-2.5 py-1.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Cloud size={12} /> {role === 'admin' ? 'ADMIN' : 'FULL'}
                </span>
              )}
              <button
                onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
                title={lang === 'pt' ? 'Switch to English 🇺🇸 (imersão!)' : 'Voltar para português 🇧🇷'}
                className="shrink-0 px-1.5 py-1 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 active:scale-95 transition text-sm leading-none"
              >
                {lang === 'pt' ? '🇺🇸' : '🇧🇷'}
              </button>
              <button
                onClick={() => setShowTutorial(true)}
                title={lang === 'pt' ? 'Como usar? Tutorial' : 'How to use? Tutorial'}
                className="shrink-0 p-1.5 sm:p-2 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 active:scale-95 transition"
              >
                <CircleHelp size={16} />
              </button>
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? t.top_theme_light : t.top_theme_dark}
                className="shrink-0 p-1.5 sm:p-2 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 active:scale-95 transition"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              {!user ? (
                <button
                  onClick={() => setShowAuth(true)}
                  title={t.top_login_title}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-2 rounded-full bg-sapphire text-white text-[11px] sm:text-xs font-black hover:bg-celadon active:scale-95"
                >
                  <LogIn size={13} /> {t.top_login}
                </button>
              ) : (
                <button
                  onClick={() => { if (confirm(`${t.app_logout_ask} ${user.email}? ${t.app_logout_confirm}`)) void signOut(); }}
                  title={`${user.email} — ${t.top_logout_title}`}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-2 rounded-full border border-slate-200 dark:border-white/10 text-[11px] sm:text-xs font-black active:scale-95 max-w-28 sm:max-w-32 truncate"
                >
                  <LogOut size={13} /> <span className="truncate max-w-16">{user.email.split('@')[0]}</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile: 5 caixas quadradas glass com número no centro e título no bottom */}
          <div className="sm:hidden grid grid-cols-5 gap-2 mt-2">
            {PILES.map((p) => {
              const active = pileFilter === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => { setPileFilter(p.key); setTab('study'); }}
                  className={`aspect-square rounded-2xl flex flex-col items-center justify-between py-2 px-1 backdrop-blur-xl border shadow-lg transition active:scale-95 ${
                    active
                      ? `${p.activeSoft} text-white`
                      : 'bg-white/50 dark:bg-white/10 border-slate-200/70 dark:border-white/15 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span className="text-2xl font-black leading-none tabular-nums">
                    {counts[p.key as keyof typeof counts] ?? 0}
                  </span>
                  <span className="flex flex-col items-center gap-0.5 text-center">
                    <span className="flex items-center">{p.icon}</span>
                    <span className="text-[10px] font-bold leading-tight">{p.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Desktop: fileira de pills glass */}
          <div className="hidden sm:flex gap-2 mt-2 sm:mt-3 overflow-x-auto pb-1">
            {PILES.map((p) => {
              const active = pileFilter === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => { setPileFilter(p.key); setTab('study'); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-bold whitespace-nowrap backdrop-blur-xl shadow-lg transition active:scale-95 ${
                    active
                      ? `${p.active} text-white`
                      : 'bg-white/50 dark:bg-white/10 border-slate-200/70 dark:border-white/15 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {p.icon} {p.label}
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-black/20' : 'bg-slate-100/80 dark:bg-white/10'}`}>
                    {counts[p.key as keyof typeof counts] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Saudação (mobile, já fora do header — rola com o conteúdo) */}
      <div className="sm:hidden max-w-5xl mx-auto px-3 pt-3 -mb-2">
        <div className="flex items-center justify-between gap-2">
          {user ? (
            <>
              <span className="text-sm font-black text-slate-700 dark:text-slate-200 truncate">
                {t.top_hello}, <span className="bg-gradient-to-r from-sapphire to-carolina bg-clip-text text-transparent">{displayName || user.email.split('@')[0]}</span>
              </span>
              <span className="shrink-0 inline-flex items-center gap-1.5">
                <span title="XP" className="inline-flex items-center gap-0.5 text-[11px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  ⚡ {xp}
                </span>
                <span title={t.top_streak_title} className="inline-flex items-center gap-0.5 text-[11px] font-black px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                  🔥 {dayStreak}
                </span>
              </span>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowAuth(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-sapphire to-carolina text-white text-xs font-black shadow-lg shadow-sapphire/25 active:scale-95 transition"
              >
                <LogIn size={13} /> {t.top_try_demo}
              </button>
              <span title={`${t.top_demo_title}: ${cards.length}/${demoMax} ${t.top_words}`} className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-black px-3 py-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                <FlaskConical size={13} /> DEMO {cards.length}/{demoMax}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  );
}
