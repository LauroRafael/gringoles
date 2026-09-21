import { useState } from 'react';
import { X, LogIn, KeyRound, MessageCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';
import { ACCESS_WHATSAPP } from './InviteModal';

export default function AuthModal() {
  const { showAuth, setShowAuth, signIn, migrateDemoToCloud, authError, authNotice, lang } = useStore();
  const t = STRINGS[lang];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [migrated, setMigrated] = useState<number | null>(null);

  if (!showAuth) return null;

  const submit = async () => {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setMigrated(null);
    try {
      const ok = await signIn(email, password);
      if (ok) {
        const n = await migrateDemoToCloud();
        setMigrated(n);
      }
    } finally {
      setBusy(false);
    }
  };

  const waText = encodeURIComponent('Olá! Quero acesso full ao Gringolês 🃏');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowAuth(false)}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-5 animate-pop-in max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-black text-lg">🃏 {t.auth_title}</h3>
          <button onClick={() => setShowAuth(false)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t.auth_sub}</p>

        <label className="block text-xs font-bold mb-2">{t.auth_email}<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@email.com" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" /></label>
        <label className="block text-xs font-bold">{t.auth_pass}<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} placeholder="••••••" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" /></label>

        {authError && <p className="mt-2 text-xs font-bold text-rose-500">{authError}</p>}
        {authNotice && <p className="mt-2 text-xs font-bold text-sky-500">{authNotice}</p>}
        {migrated !== null && migrated > 0 && <p className="mt-2 text-xs font-bold text-emerald-500">✅ {migrated} {t.auth_migrated}</p>}

        <button onClick={() => void submit()} disabled={busy || !email.trim() || !password} className="mt-3 w-full py-3 rounded-2xl bg-sapphire text-white font-black disabled:opacity-40 active:scale-[0.98] inline-flex justify-center items-center gap-1">
          <LogIn size={16} /> {busy ? t.auth_wait : t.auth_go}
        </button>

        <div className="mt-3 rounded-2xl border border-celadon dark:border-carolina/30 bg-azure dark:bg-carolina/10 p-3 text-center">
          <p className="text-xs font-black inline-flex items-center gap-1 text-sapphire dark:text-carolina">
            <KeyRound size={13} /> {t.auth_noaccess}
          </p>
          <div className="flex flex-col gap-2 mt-2">
            <a href={`https://wa.me/${ACCESS_WHATSAPP}?text=${waText}`} target="_blank" rel="noreferrer" className="inline-flex justify-center items-center gap-1 px-3 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-black active:scale-95">
              <MessageCircle size={15} /> WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
