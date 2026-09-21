import { useEffect, useState } from 'react';
import { GraduationCap, LibraryBig, Target, Keyboard, BarChart3, ShieldCheck, Loader2, Lock } from 'lucide-react';
import TopBar from './components/TopBar';
import StudyDeck from './components/StudyDeck';
import Library from './components/Library';
import QuizMode from './components/QuizMode';
import TypeMode from './components/TypeMode';
import StatsView from './components/StatsView';
import AuthModal from './components/AuthModal';
import InviteModal from './components/InviteModal';
import AdminPanel from './components/AdminPanel';
import ChangePasswordGate from './components/ChangePasswordGate';
import TabErrorBoundary from './components/TabErrorBoundary';
import TutorialModal, { wasTutorialSeen } from './components/TutorialModal';
import PwaUpdater from './components/PwaUpdater';
import PwaStatus from './components/PwaStatus';
import { useStore, applyStoredTheme } from './store/useStore';
import { STRINGS } from './lib/i18n';
import type { Tab } from './types';

export default function App() {
  const { tab, setTab, theme, ensureDailyWords, initAuth, authLoading, role, user, lang, setShowTutorial,
    cloudNotice, clearCloudNotice, mustChangePassword } = useStore();
  const [dailyAdded, setDailyAdded] = useState<number | null>(null);
  const t = STRINGS[lang];

  const BASE_TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'study', label: t.nav_study, icon: <GraduationCap size={20} /> },
    { key: 'library', label: t.nav_library, icon: <LibraryBig size={20} /> },
    { key: 'quiz', label: t.nav_quiz, icon: <Target size={20} /> },
    { key: 'type', label: t.nav_type, icon: <Keyboard size={20} /> },
    { key: 'stats', label: t.nav_stats, icon: <BarChart3 size={20} /> },
  ];

  useEffect(() => {
    applyStoredTheme();
    // Tutorial abre de imediato (síncrono) — sem depender da rede/Supabase.
    // ?notour=1 pula (útil para screenshots e testes).
    const skipTour = new URLSearchParams(window.location.search).has('notour');
    if (!skipTour && !wasTutorialSeen()) setShowTutorial(true);
    void (async () => {
      await initAuth();
      const n = await ensureDailyWords();
      if (n > 0) {
        setDailyAdded(n);
        window.setTimeout(() => setDailyAdded(null), 6000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  }, [theme, lang]);

  const TABS = role === 'admin' && tab !== undefined
    ? [...BASE_TABS, { key: 'admin' as Tab, label: 'Admin', icon: <ShieldCheck size={20} /> }]
    : BASE_TABS;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* fundo decorativo */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-sapphire/20 blur-3xl" />
        <div className="absolute top-40 -right-32 w-96 h-96 rounded-full bg-carolina/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 rounded-full bg-amber-400/10 blur-3xl" />
      </div>

      {authLoading ? (
        <div className="min-h-screen flex flex-col items-center justify-center gap-2 text-slate-500">
          <Loader2 size={28} className="animate-spin text-celadon" />
          <p className="text-sm font-bold">{t.app_loading}</p>
        </div>
      ) : (
        <>
          <TopBar />

          <PwaUpdater />
          <PwaStatus />

          {dailyAdded !== null && dailyAdded > 0 && (
            <div className="max-w-5xl mx-auto px-4 pt-4">
              <div className="px-4 py-3 rounded-2xl bg-gradient-to-r from-sapphire to-carolina text-white text-sm font-bold shadow-lg animate-pop-in">
                🎉 {dailyAdded} {t.app_daily}
              </div>
            </div>
          )}

          {cloudNotice && (
            <div className="max-w-5xl mx-auto px-4 pt-4">
              <div className="px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-300 text-sm font-bold animate-pop-in flex items-center justify-between gap-2">
                <span>{cloudNotice}</span>
                <button onClick={clearCloudNotice} className="text-xs underline whitespace-nowrap">{t.app_dismiss}</button>
              </div>
            </div>
          )}

          <main className="max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-6 pb-24 sm:pb-28">
            <TabErrorBoundary tabKey={tab} lang={lang}>
              {tab === 'study' && <StudyDeck />}
              {tab === 'library' && <Library />}
              {tab === 'quiz' && <QuizMode />}
              {tab === 'type' && <TypeMode />}
              {tab === 'stats' && <StatsView />}
              {tab === 'admin' && <AdminPanel />}
            </TabErrorBoundary>
          </main>

          {/* Navegação inferior */}
          <nav className="fixed bottom-0 inset-x-0 z-40 backdrop-blur-xl bg-white/85 dark:bg-slate-950/85 border-t border-slate-200 dark:border-white/10">
            <div className={`max-w-5xl mx-auto px-3 sm:px-4 py-1.5 sm:py-2 grid gap-1 ${TABS.length > 5 ? 'grid-cols-6' : 'grid-cols-5'}`}>
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                className={`relative flex flex-col items-center gap-0.5 py-2 rounded-2xl text-xs font-bold transition active:scale-95 ${
                  active
                    ? 'bg-gradient-to-t from-sapphire to-carolina text-white shadow-lg shadow-sapphire/30'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
                title={t.key === 'library' && !user ? '🔒 Edição disponível na versão full' : undefined}
              >
                {t.icon}
                <span className="inline-flex items-center gap-0.5">
                  {t.label}
                  {t.key === 'library' && !user && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-px rounded-full bg-sapphire text-white">
                      <Lock size={9} />
                    </span>
                  )}
                </span>
              </button>
                );
              })}
            </div>
          </nav>

          <AuthModal />
          <InviteModal />
          <TutorialModal />
          {mustChangePassword && <ChangePasswordGate />}
        </>
      )}
    </div>
  );
}
