import { X, KeyRound, MessageCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STRINGS } from '../lib/i18n';

export const ACCESS_WHATSAPP = '5562991115430';

export default function InviteModal() {
  const { showInvite, setShowInvite, inviteMsg, demoMax, lang } = useStore();
  const t = STRINGS[lang];
  if (!showInvite) return null;
  const waText = encodeURIComponent('Olá! Quero acesso full ao Gringolês 🃏');
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowInvite(false)}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-5 animate-pop-in text-center" onClick={(e) => e.stopPropagation()}>
        <p className="text-5xl mb-2">🎓</p>
        <h3 className="font-black text-lg">{t.inv_limit} {demoMax} {t.inv_words}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{inviteMsg}</p>
        <div className="mt-4 rounded-2xl border border-celadon dark:border-carolina/30 bg-azure dark:bg-carolina/10 p-3">
          <p className="text-xs font-black inline-flex items-center gap-1 text-sapphire dark:text-carolina">
            <KeyRound size={13} /> {t.inv_need}
          </p>
          <div className="flex flex-col gap-2 mt-2">
            <a href={`https://wa.me/${ACCESS_WHATSAPP}?text=${waText}`} target="_blank" rel="noreferrer" className="inline-flex justify-center items-center gap-1 px-3 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-black active:scale-95">
              <MessageCircle size={15} /> WhatsApp
            </a>
          </div>
        </div>
        <button onClick={() => setShowInvite(false)} className="mt-2 w-full py-2 text-xs font-bold text-slate-500 inline-flex justify-center items-center gap-1"><X size={13} /> {t.inv_continue}</button>
      </div>
    </div>
  );
}
