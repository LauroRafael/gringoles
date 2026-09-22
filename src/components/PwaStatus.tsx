import { useEffect, useState } from 'react';
import { WifiOff, Share } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

const IOS_HIDE_KEY = 'gringoles-ios-guide-hide';
const INSTALL_HIDE_KEY = 'gringoles-install-hide';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIOS(): boolean {
  try {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Status offline + guia de instalação no iOS. */
export default function PwaStatus() {
  const { lang, user, flushOutbox } = useStore();
  const t = STRINGS[lang];
  const [online, setOnline] = useState(() => {
    try {
      return navigator.onLine;
    } catch {
      return true;
    }
  });
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    let hidden = false;
    try {
      hidden = localStorage.getItem(IOS_HIDE_KEY) === '1';
    } catch { /* noop */ }
    if (isIOS() && !isStandalone() && !hidden) setShowIos(true);
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      try {
        if (localStorage.getItem(INSTALL_HIDE_KEY) === '1' || isStandalone()) return;
      } catch { /* noop */ }
      setInstallEvt(e as BeforeInstallPromptEvent);
      setShowInstall(true);
    };
    const onInstalled = () => {
      setInstallEvt(null);
      setShowInstall(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const on = async () => {
      setOnline(true);
      if (user) {
        setSyncMsg(t.pwa_back);
        try {
          const n = await flushOutbox();
          setSyncMsg(n > 0 ? t.pwa_synced : null);
        } catch {
          setSyncMsg(null);
        } finally {
          window.setTimeout(() => setSyncMsg(null), 4000);
        }
      }
    };
    const off = () => {
      setOnline(false);
      setSyncMsg(null);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const hideIos = () => {
    try {
      localStorage.setItem(IOS_HIDE_KEY, '1');
    } catch { /* noop */ }
    setShowIos(false);
  };

  const dismissInstall = () => {
    try {
      localStorage.setItem(INSTALL_HIDE_KEY, '1');
    } catch { /* noop */ }
    setInstallEvt(null);
    setShowInstall(false);
  };

  const install = async () => {
    if (!installEvt) return;
    try {
      await installEvt.prompt();
      await installEvt.userChoice;
    } catch { /* noop */ }
    dismissInstall();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4 space-y-2">
      {!online && (
        <div className="px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm font-bold animate-pop-in inline-flex items-center gap-2 w-full">
          <WifiOff size={16} className="shrink-0" />
          <span>{t.pwa_offline}</span>
        </div>
      )}
      {online && syncMsg && (
        <div className="px-4 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-sm font-bold animate-pop-in">
          {syncMsg}
        </div>
      )}
      {showInstall && !isStandalone() && (
        <div className="px-4 py-3 rounded-2xl bg-gradient-to-r from-sapphire to-carolina text-white text-sm animate-pop-in">
          <p className="font-black">{t.pwa_install_title}</p>
          <p className="text-xs mt-1 opacity-90">{t.pwa_install_body}</p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => void install()} className="px-3 py-1.5 rounded-xl bg-white text-prussian text-xs font-black active:scale-95">
              {t.pwa_install_cta}
            </button>
            <button onClick={dismissInstall} className="px-3 py-1.5 rounded-xl text-xs font-bold underline underline-offset-2 opacity-90 active:scale-95">
              {t.pwa_install_later}
            </button>
          </div>
        </div>
      )}
      {showIos && (
        <div className="px-4 py-3 rounded-2xl bg-gradient-to-r from-prussian to-sapphire text-white text-sm animate-pop-in">
          <p className="font-black inline-flex items-center gap-1"><Share size={15} /> {t.pwa_ios_title}</p>
          <p className="text-xs mt-1 opacity-90">{t.pwa_ios_body}</p>
          <button onClick={hideIos} className="mt-2 px-3 py-1.5 rounded-xl bg-white text-prussian text-xs font-black active:scale-95">
            {t.pwa_ios_ok}
          </button>
        </div>
      )}
    </div>
  );
}
