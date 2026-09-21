import { BookOpen, Flame, Moon, Sparkles, Sun, Megaphone, CheckCircle2, LogIn, LogOut, Cloud, FlaskConical, CircleHelp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';
import type { Pile } from '../types';

interface PileTab { key: Pile | 'all' | 'due'; label: string; icon: React.ReactNode; active: string }

export default function TopBar() {
  const { cards, pileFilter, setPileFilter, setTab, theme, toggleTheme, xp, dayStreak,
    user, role, signOut, setShowAuth, demoMax, labelLearning, labelKnown, lang, setLang, setShowTutorial } = useStore();
  const t = STRINGS[lang];
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

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-white/10">
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button onClick={() => setTab('study')} className="flex items-center gap-2 text-left">
            <span className="text-3xl animate-float">🃏</span>
            <span>
              <span className="block font-black text-xl leading-none bg-gradient-to-r from-sapphire via-carolina to-celadon bg-clip-text text-transparent">
                Gringolês
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{t.top_subtitle}</span>
            </span>
          </button>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!user ? (
              <span title={`${t.top_demo_title}: ${cards.length}/${demoMax} ${t.top_words}`} className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                <FlaskConical size={14} /> DEMO {cards.length}/{demoMax}
              </span>
            ) : (
              <span title={role === 'admin' ? t.top_admin_title : t.top_full_title} className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Cloud size={14} /> {role === 'admin' ? 'ADMIN' : 'FULL'}
              </span>
            )}
            <span title="XP" className="hidden sm:inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              ⚡ {xp} XP
            </span>
            <span title="Dias seguidos" className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
              <Flame size={14} /> {dayStreak}
            </span>
            <button
              onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
              title={lang === 'pt' ? 'Switch to English 🇺🇸 (imersão!)' : 'Voltar para português 🇧🇷'}
              className="px-2 py-1.5 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:scale-105 transition text-base leading-none"
            >
              {lang === 'pt' ? '🇺🇸' : '🇧🇷'}
            </button>
            <button
              onClick={() => setShowTutorial(true)}
              title={lang === 'pt' ? 'Como usar? Tutorial' : 'How to use? Tutorial'}
              className="p-2 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:scale-105 transition"
            >
              <CircleHelp size={18} />
            </button>
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? t.top_theme_light : t.top_theme_dark}
              className="p-2 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:scale-105 transition"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {!user ? (
              <button
                onClick={() => setShowAuth(true)}
                title={t.top_login_title}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-sapphire text-white text-xs font-black hover:bg-celadon active:scale-95"
              >
                <LogIn size={14} /> {t.top_login}
              </button>
            ) : (
              <button
                onClick={() => { if (confirm(`Sair da conta ${user.email}? ${t.app_logout_confirm}`)) void signOut(); }}
                title={`${user.email} — sair e voltar ao demo`}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full border border-slate-200 dark:border-white/10 text-xs font-black active:scale-95 max-w-32 truncate"
              >
                <LogOut size={14} /> <span className="truncate max-w-20">{user.email.split('@')[0]}</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
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
