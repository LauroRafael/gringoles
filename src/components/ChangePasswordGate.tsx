import { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

/** Bloqueia o app até o admin trocar a senha inicial. */
export default function ChangePasswordGate() {
  const { changePassword, authError, signOut, lang } = useStore();
  const t = STRINGS[lang];
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = async () => {
    setLocalErr(null);
    if (pw1.length < 6) {
      setLocalErr(t.pwd_short);
      return;
    }
    if (pw1 !== pw2) {
      setLocalErr(t.pwd_mismatch);
      return;
    }
    setBusy(true);
    try {
      await changePassword(pw1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 animate-pop-in">
        <p className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <ShieldAlert size={13} /> {t.pwd_gate}
        </p>
        <h3 className="font-black text-lg mt-2">{t.pwd_title}</h3>
        <p className="text-xs text-slate-500 mt-1">{t.pwd_sub}</p>
        <label className="block text-xs font-bold mt-3">{t.pwd_new}<input value={pw1} onChange={(e) => setPw1(e.target.value)} type="password" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" /></label>
        <label className="block text-xs font-bold mt-2">{t.pwd_repeat}<input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" /></label>
        {(localErr || authError) && <p className="mt-2 text-xs font-bold text-rose-500">{localErr ?? authError}</p>}
        <button onClick={() => void submit()} disabled={busy} className="mt-3 w-full py-3 rounded-2xl bg-sapphire text-white font-black disabled:opacity-40 active:scale-[0.98] inline-flex justify-center items-center gap-1">
          <KeyRound size={16} /> {busy ? t.pwd_saving : t.pwd_save}
        </button>
        <button onClick={() => void signOut()} className="mt-2 w-full py-2 text-xs font-bold text-slate-500">{t.pwd_exit}</button>
      </div>
    </div>
  );
}
