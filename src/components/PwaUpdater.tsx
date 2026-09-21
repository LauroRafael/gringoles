import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

/** Banner "Nova versão disponível → Atualizar" (registerType: prompt, sem reload surpresa). */
export default function PwaUpdater() {
  const { lang } = useStore();
  const t = STRINGS[lang];
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW] = useState(() =>
    registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
    }),
  );

  if (!needRefresh) return null;
  return (
    <div className="max-w-5xl mx-auto px-4 pt-4">
      <div className="px-4 py-3 rounded-2xl bg-gradient-to-r from-sapphire to-carolina text-white text-sm font-bold shadow-lg animate-pop-in flex items-center gap-2">
        <RefreshCw size={16} className="shrink-0" />
        <span className="flex-1">{t.pwa_update}</span>
        <button
          onClick={() => void updateSW(true)}
          className="px-3 py-1.5 rounded-xl bg-white text-sapphire text-xs font-black active:scale-95 whitespace-nowrap"
        >
          {t.pwa_refresh}
        </button>
      </div>
    </div>
  );
}
