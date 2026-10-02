import { useEffect, useState } from 'react';
import { X, UserRound, KeyRound, LogOut, Save } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';
import { passwordIssue } from '../lib/password';

/** Perfil do usuário: modal centralizado — troca nome + redefine a própria senha. */
export default function ProfileModal() {
  const { showProfile, setShowProfile, user, displayName, updateDisplayName,
    changePassword, authError, signOut, lang } = useStore();
  const t = STRINGS[lang];
  const [name, setName] = useState(displayName || '');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busyName, setBusyName] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (showProfile) {
      setName(displayName || '');
      setPw1('');
      setPw2('');
      setMsg(null);
      setErr(null);
    }
  }, [showProfile, displayName]);

  if (!showProfile || !user) return null;

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    window.setTimeout(() => setMsg(null), 5000);
  };
  const fail = (m: string) => {
    setErr(m);
    setMsg(null);
  };

  const saveName = async () => {
    setBusyName(true);
    try {
      const res = await updateDisplayName(name);
      if (res.ok) flash(res.msg);
      else fail(res.msg);
    } finally {
      setBusyName(false);
    }
  };

  const savePw = async () => {
    setErr(null);
    const issue = passwordIssue(pw1);
    if (issue) {
      fail(issue === 'short' ? t.pwd_short : t.pwd_weak);
      return;
    }
    if (pw1 !== pw2) {
      fail(t.pwd_mismatch);
      return;
    }
    setBusyPw(true);
    try {
      const ok = await changePassword(pw1);
      if (ok) {
        setPw1('');
        setPw2('');
        flash(t.prof_pw_ok);
      }
    } finally {
      setBusyPw(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setShowProfile(false)}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 animate-pop-in max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-black text-lg inline-flex items-center gap-1.5">
            <UserRound size={18} /> {t.prof_title}
          </h3>
          <button onClick={() => setShowProfile(false)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t.prof_sub}</p>

        <label className="block text-xs font-bold">{t.prof_email}
          <input value={user.email} disabled className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm opacity-70" />
        </label>

        <label className="block text-xs font-bold mt-3">{t.prof_name}
          <div className="mt-1 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={user.email.split('@')[0]}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm"
            />
            <button
              onClick={() => void saveName()}
              disabled={busyName || !name.trim() || name.trim() === (displayName || '')}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2.5 rounded-xl bg-sapphire text-white text-xs font-black disabled:opacity-40 active:scale-95"
            >
              <Save size={14} /> {busyName ? '...' : t.prof_save}
            </button>
          </div>
        </label>

        <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/10 p-3">
          <p className="text-xs font-black inline-flex items-center gap-1">
            <KeyRound size={13} /> {t.prof_pw_title}
          </p>
          <label className="block text-xs font-bold mt-2">{t.pwd_new}
            <input value={pw1} onChange={(e) => setPw1(e.target.value)} type="password" placeholder="••••••" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" />
          </label>
          <label className="block text-xs font-bold mt-2">{t.pwd_repeat}
            <input
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              type="password"
              placeholder="••••••"
              onKeyDown={(e) => { if (e.key === 'Enter') void savePw(); }}
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm"
            />
          </label>
          <button
            onClick={() => void savePw()}
            disabled={busyPw || !pw1 || !pw2}
            className="mt-3 w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-black disabled:opacity-40 active:scale-[0.98] inline-flex justify-center items-center gap-1"
          >
            <KeyRound size={15} /> {busyPw ? t.pwd_saving : t.prof_pw_save}
          </button>
        </div>

        {(err || authError) && <p className="mt-2 text-xs font-bold text-rose-500">{err ?? authError}</p>}
        {msg && <p className="mt-2 text-xs font-bold text-emerald-500">{msg}</p>}

        <button
          onClick={() => {
            setShowProfile(false);
            if (confirm(`${t.app_logout_ask} ${user.email}? ${t.app_logout_confirm}`)) void signOut();
          }}
          className="mt-3 w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-500/20 text-rose-500 text-xs font-black inline-flex justify-center items-center gap-1 active:scale-[0.98]"
        >
          <LogOut size={14} /> {t.prof_logout}
        </button>
      </div>
    </div>
  );
}
