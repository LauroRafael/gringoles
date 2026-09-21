import { useState } from 'react';
import { BookOpen, Flame, Moon, Sparkles, Sun, Megaphone, CheckCircle2, LogIn, LogOut, Cloud, FlaskConical, CircleHelp, Menu, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';
import type { Pile } from '../types';

interface PileTab { key: Pile | 'all' | 'due'; label: string; icon: React.ReactNode; active: string }

export default function TopBar() {
  const { cards, pileFilter, setPileFilter, setTab, theme, toggleTheme, xp, dayStreak,
    user, role, signOut, setShowAuth, demoMax, labelLearning, labelKnown, lang, setLang, setShowTutorial } = useStore();
  const t = STRINGS[lang];
  const [menuOpen, setMenuOpen] = useState(false);
  const PILES: PileTab[] = [
    { key: 'new', label: t.pile_new, icon: <Sparkles size={16} />, active: 'bg-sky-500 text-white border-sky-500' },
    { key: 'due', label: t.pile_study, icon: <BookOpen size={16} />, active: 'bg-sapphire text-white border-sapphire' },
    { key: 'learning', label: labelLearning, icon: <Megaphone size={16} />, active: 'bg-rose-500 text-white border-rose-500' },
    { key: 'known', label: labelKnown, icon: <CheckCircle2 size={16} />, active: 'bg-emerald-500 text-white border-emerald-500' },
    // Pilha "Todas" desativada por enquanto ( filtro 'all' segue funcionando via código ) — descomente para reexibir:
    // { key: 'all', label: 'Todas', icon: <BookOpen size={16} />, active: 'bg-slate-700 text-white border-slate-700' },
  ];
  const now = Date.now();
  const counts = {
    new: cards.filter((c) => c.pile === 'new').length,
    learning: cards.filter((c) => c.pile === 'learning').length,
    known: cards.filter((c) => c.pile === 'known').length,
    due: cards.filter((c) => c.nextReviewAt <= now).length,
    all: cards.length,
  };
  const activePile = PILES.find((p) => p.key === pileFilter) ?? PILES[0];

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-white/10">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-1 sm:pt-4 pb-1 sm:pb-3">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <button onClick={() => setTab('study')} className="flex items-center gap-1.5 sm:gap-2 text-left shrink-0">
            <span className="inline-flex items-center justify-center h-7 w-7 sm:h-9 sm:w-9 rounded-lg bg-azure dark:bg-azure shrink-0 overflow-hidden">
              <img src="/img/concept-c.png" alt="Gringolês" className="h-5 w-5 sm:h-7 sm:w-7 object-contain" />
            </span>
            <span>
              <span className="block font-black text-[15px] sm:text-xl leading-none bg-gradient-to-r from-sapphire via-carolina to-celadon bg-clip-text text-transparent">
                Gringolês
              </span>
              <span className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">{t.top_subtitle}</span>
            </span>
          </button>

          <div className="flex items-center gap-1 sm:gap-2 justify-end overflow-x-auto min-w-0 py-0.5">
            <span title="XP" className="shrink-0 hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              ⚡ {xp} XP
            </span>
            <span title="Dias seguidos" className="shrink-0 hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
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
                onClick={() => { if (confirm(`Sair da conta ${user.email}? ${t.app_logout_confirm}`)) void signOut(); }}
                title={`${user.email} — sair e voltar ao demo`}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-2 rounded-full border border-slate-200 dark:border-white/10 text-[11px] sm:text-xs font-black active:scale-95 max-w-28 sm:max-w-32 truncate"
              >
                <LogOut size={13} /> <span className="truncate max-w-16">{user.email.split('@')[0]}</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile: hambúrguer com a pilha ativa + painel suspenso */}
        <div className="sm:hidden mt-1 relative flex items-center justify-between gap-2">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-bold active:scale-95"
          >
            {menuOpen ? <X size={14} /> : <Menu size={14} />}
            {activePile.icon} {activePile.label}
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/10">
              {counts[activePile.key as keyof typeof counts] ?? 0}
            </span>
          </button>
          {!user ? (
            <span title={`${t.top_demo_title}: ${cards.length}/${demoMax} ${t.top_words}`} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-black px-3 py-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              <FlaskConical size={13} /> DEMO {cards.length}/{demoMax}
            </span>
          ) : (
            <span title={role === 'admin' ? t.top_admin_title : t.top_full_title} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-black px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Cloud size={13} /> {role === 'admin' ? 'ADMIN' : 'FULL'}
            </span>
          )}
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute z-50 mt-2 w-56 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl p-2 animate-pop-in">
                {PILES.map((p) => {
                  const active = pileFilter === p.key;
                  return (
                    <button
                      key={p.key}
                      onClick={() => { setPileFilter(p.key); setTab('study'); setMenuOpen(false); }}
                      className={`w-full inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold active:scale-[0.98] ${
                        active ? `${p.active} text-white` : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
                      }`}
                    >
                      {p.icon} {p.label}
                      <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-black/20' : 'bg-slate-100 dark:bg-white/10'}`}>
                        {counts[p.key as keyof typeof counts] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Desktop: fileira de pilhas */}
        <div className="hidden sm:flex gap-2 mt-2 sm:mt-3 overflow-x-auto pb-1">
          {PILES.map((p) => {
            const active = pileFilter === p.key;
            return (
              <button
                key={p.key}
                onClick={() => { setPileFilter(p.key); setTab('study'); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-bold whitespace-nowrap transition active:scale-95 ${
                  active ? p.active : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
                }`}
              >
                {p.icon} {p.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-black/20' : 'bg-slate-100 dark:bg-white/10'}`}>
                  {counts[p.key as keyof typeof counts] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
