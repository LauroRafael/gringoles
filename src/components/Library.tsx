import { useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Search, Trash2, Upload, Download, Volume2, RotateCcw, X, Lock, Crown } from 'lucide-react';
import { useStore } from '../store/useStore';
import { speakEN } from '../lib/speech';
import { findDuplicate } from '../lib/dedupe';
import { compressImage } from '../lib/image';
import { completeWord } from '../lib/cloud';
import { uploadPhoto } from '../lib/cloud';
import { STRINGS } from '../lib/i18n';
import EmojiPicker from './EmojiPicker';
import type { Card } from '../types';

const GRADIENTS = [
  'from-sapphire to-carolina',
  'from-prussian to-celadon',
  'from-celadon to-carolina',
  'from-sapphire to-celadon',
  'from-prussian to-sapphire',
  'from-carolina to-celadon',
];

/** Linha extra com as cores clássicas (antes da paleta azul). */
const CLASSIC_GRADIENTS = [
  'from-violet-500 to-fuchsia-500',
  'from-sky-500 to-cyan-400',
  'from-amber-500 to-orange-500',
  'from-emerald-500 to-teal-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-violet-500',
  'from-lime-500 to-emerald-500',
  'from-blue-600 to-indigo-500',
];

const emptyForm = {
  en: '', pt: '', phoneticBR: '', ipa: '', exampleEN: '', examplePT: '',
  emoji: '📚', photo: '', photoUrl: '', gradient: GRADIENTS[0], category: 'Minhas',
};

/** Primeira letra sempre maiúscula (visual + valor). */
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function Library() {
  const { cards, user, addCard, updateCard, removeCard, movePile, importCards, setShowInvite, lang } = useStore();
  const t = STRINGS[lang];
  /** Demo = vitrine bloqueada: tudo visível, edição só na full. */
  const locked = !user;
  const needFull = (acao: string) =>
    setShowInvite(true, `🔒 "${acao}" — ${t.lib_lock_title.replace('🔒 ', '')}.`);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | Card['pile']>('all');
  const [editing, setEditing] = useState<null | (typeof emptyForm & { id?: string })>(null);
  const [forceDup, setForceDup] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const liveDup = editing && !editing.id ? findDuplicate(cards, editing.en) : undefined;

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 5000);
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter !== 'all' && c.pile !== filter) return false;
      if (!needle) return true;
      return (c.en + ' ' + c.pt + ' ' + c.category).toLowerCase().includes(needle);
    });
  }, [cards, q, filter]);

  const openNew = () => { setForceDup(false); setEditing({ ...emptyForm }); };
  const openEdit = (c: Card) => { setForceDup(false); setEditing({ ...emptyForm, ...c, photo: c.photo ?? '', photoUrl: c.photoUrl ?? '' }); };

  const saveForm = () => {
    if (!editing || !editing.en.trim() || !editing.pt.trim()) return;
    if (editing.id) {
      const { id, ...patch } = editing;
      const dup = findDuplicate(cards, editing.en, id);
      if (dup) {
        flash(`⚠️ "${editing.en}" ${t.lib_dup_warn} "${dup.pt}". ${t.lib_dup_kept}`);
        setEditing(null);
        return;
      }
      updateCard(id, patch);
    } else {
      const res = addCard({ ...editing }, { allowDuplicate: forceDup });
      if (!res.ok) {
        if (res.reason === 'limit') return; // modal de convite já aberto pelo store
        flash(`⚠️ "${editing.en}" ${t.lib_dup_warn} (${res.duplicate?.pt}). ${t.lib_dup_anyway}`);
        return;
      }
    }
    setForceDup(false);
    setEditing(null);
  };

  const [photoBusy, setPhotoBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  const fetchAI = async () => {
    if (!editing || aiBusy) return;
    const seed = editing.en.trim() || editing.pt.trim();
    if (!seed) return;
    setAiBusy(true);
    setAiMsg(null);
    try {
      const f = await completeWord(seed);
      const filled: string[] = [];
      const patch: Partial<typeof editing> = {};
      if (f.en && !editing.en.trim()) { patch.en = capFirst(f.en.trim()); filled.push(t.lib_f_en); }
      if (f.pt && !editing.pt.trim()) { patch.pt = capFirst(f.pt.trim()); filled.push(t.lib_f_pt); }
      if (f.phonetic_br && !editing.phoneticBR.trim()) { patch.phoneticBR = f.phonetic_br; filled.push(t.lib_f_say); }
      if (f.ipa && !editing.ipa.trim()) { patch.ipa = f.ipa; filled.push(t.lib_f_ipa); }
      if (f.example_en && !editing.exampleEN.trim()) { patch.exampleEN = f.example_en; filled.push(t.lib_f_exen); }
      if (f.example_pt && !editing.examplePT.trim()) { patch.examplePT = f.example_pt; filled.push(t.lib_f_expt); }
      if (f.emoji && (!editing.emoji.trim() || editing.emoji === '📚')) { patch.emoji = f.emoji; filled.push('Emoji'); }
      if (f.category && (!editing.category.trim() || editing.category === 'Minhas')) { patch.category = f.category; filled.push(t.lib_f_cat); }
      if (filled.length > 0) {
        setEditing({ ...editing, ...patch });
        setAiMsg(`✅ ${t.lib_dict_filled}: ${filled.join(' + ')}. ${t.lib_dict_check}`);
      } else {
        setAiMsg(`ℹ️ ${t.lib_dict_found}, ${t.lib_dict_kept}`);
      }
    } catch {
      setAiMsg(t.lib_ai_nothing);
    } finally {
      setAiBusy(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file || !editing) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await compressImage(file);
      if (user) {
        // Modo full: sobe ao Storage e guarda a URL pública.
        const url = await uploadPhoto(user.id, dataUrl);
        setEditing({ ...editing, photo: '', photoUrl: url });
      } else {
        setEditing({ ...editing, photo: dataUrl, photoUrl: '' });
      }
    } catch {
      flash(t.lib_photo_bad);
    } finally {
      setPhotoBusy(false);
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gringoles-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJSON = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed)) {
          const { added, skipped, limited } = importCards(parsed as Card[]);
          flash(`📥 ${t.lib_imp_ok}: ${added} ${t.lib_imp_new}, ${skipped} ${t.lib_imp_dup}${limited ? ` ${t.lib_imp_limited}` : ''}.`);
        }
      } catch {
        flash(t.lib_imp_bad);
      }
    };
    reader.readAsText(file);
  };

  /** Importa CSV ou TSV (planilhas): colunas EN, PT, fonética, IPA, exemploEN, exemploPT, categoria. */
  const importCSV = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result).replace(/^\uFEFF/, '');
        const delim = text.includes('\t') ? '\t' : ';';
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return;
        const hasHeader = /^(en|ingl|english|frente)/i.test(lines[0]);
        const rows = (hasHeader ? lines.slice(1) : lines).map((l) =>
          l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')),
        );
        const now = Date.now();
        const incoming: Card[] = rows
          .filter((r) => r[0] && r[1])
          .map((r, i) => ({
            id: `csv-${now}-${i}`,
            en: r[0],
            pt: r[1],
            phoneticBR: r[2] ?? '',
            ipa: r[3] ?? '',
            exampleEN: r[4] ?? '',
            examplePT: r[5] ?? '',
            emoji: '📚',
            gradient: GRADIENTS[i % GRADIENTS.length],
            category: r[6] || 'Importadas',
            pile: 'new' as const,
            box: 0,
            nextReviewAt: now,
            correctStreak: 0,
            seenCount: 0,
            createdAt: now + i,
          }));
        const { added, skipped } = importCards(incoming);
        flash(`📥 ${t.lib_imp_csv}: ${added} ${t.lib_imp_new}, ${skipped} ${t.lib_imp_dup}.`);
      } catch {
        flash(t.lib_csv_bad);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <label className="flex-1 inline-flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
          <Search size={18} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.lib_search}
            className="bg-transparent outline-none w-full text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button onClick={() => (locked ? needFull(t.lib_lock_new) : openNew())} title={locked ? t.lib_lock_title : t.lib_new} className="inline-flex items-center gap-1 px-4 py-2.5 rounded-2xl bg-sapphire text-white text-sm font-bold hover:bg-celadon active:scale-95">
            {locked ? <Lock size={16} /> : <Plus size={16} />} {t.lib_new}
          </button>
          <button onClick={exportJSON} title={t.lib_export} className="p-2.5 rounded-2xl border border-slate-200 dark:border-white/10 active:scale-95"><Download size={18} /></button>
          <button onClick={() => (locked ? needFull(t.lib_lock_json) : fileRef.current?.click())} title={locked ? t.lib_lock_title : t.lib_import_json} className="p-2.5 rounded-2xl border border-slate-200 dark:border-white/10 active:scale-95">{locked ? <Lock size={18} /> : <Upload size={18} />}</button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => importJSON(e.target.files?.[0])} />
          <button onClick={() => (locked ? needFull(t.lib_lock_csv) : csvRef.current?.click())} title={locked ? t.lib_lock_title : t.lib_import_csv} className="px-2.5 rounded-2xl border border-slate-200 dark:border-white/10 text-xs font-black active:scale-95 inline-flex items-center gap-1">{locked && <Lock size={13} />}CSV</button>
          <input ref={csvRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => importCSV(e.target.files?.[0])} />
        </div>
      </div>

      {locked && (
        <div className="mb-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-sapphire/10 to-carolina/10 border border-celadon dark:border-carolina/30 flex items-center gap-2 animate-pop-in">
          <Lock size={16} className="text-celadon shrink-0" />
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300 flex-1">
            {t.lib_demo_banner} <b>{t.lib_demo_banner_mid}</b> {t.lib_demo_banner_end} <b>{t.lib_demo_banner_full}</b>.
          </p>
          <button onClick={() => needFull(t.lib_edit)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sapphire text-white text-xs font-black whitespace-nowrap active:scale-95">
            <Crown size={13} /> {t.lib_full_btn}
          </button>
        </div>
      )}

      {notice && (
        <div className="mb-3 px-4 py-2.5 rounded-2xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 text-sm font-bold text-sky-700 dark:text-sky-300 animate-pop-in">
          {notice}
        </div>
      )}

      <div className="flex gap-2 mb-4 text-sm font-bold">
        {(['all', 'new', 'learning', 'known'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border active:scale-95 ${filter === f ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent' : 'border-slate-200 dark:border-white/10'}`}
          >
            {f === 'all' ? `${t.pile_all} (${cards.length})` : f === 'new' ? `${t.pile_new} (${cards.filter((c) => c.pile === 'new').length})` : f === 'learning' ? `${t.pile_learning} (${cards.filter((c) => c.pile === 'learning').length})` : `${t.pile_known} (${cards.filter((c) => c.pile === 'known').length})`}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((c) => (
          <div key={c.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden animate-pop-in">
            <div className={`h-24 bg-gradient-to-br ${c.gradient} flex items-center justify-center text-5xl relative overflow-hidden`}>
              {(c.photoUrl || c.photo) ? (
                <>
                  <img src={c.photoUrl || c.photo} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-60" />
                  <img src={c.photoUrl || c.photo} alt={c.en} className="relative max-w-full max-h-full object-contain drop-shadow" />
                </>
              ) : c.emoji}
              <span className="absolute bottom-1.5 left-1.5 text-[10px] font-black px-2 py-0.5 rounded-full bg-black/50 text-white">{c.category}</span>
              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-black px-2 py-0.5 rounded-full bg-black/50 text-white">
                {c.pile === 'new' ? `✨ ${t.pill_new}` : c.pile === 'known' ? `✅ ${t.pile_known}` : `📚 ${t.pile_learning}`}
              </span>
            </div>
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-black text-lg leading-tight">{c.en}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-300">{c.pt} · "{c.phoneticBR}"</p>
                </div>
                <button onClick={() => speakEN(c.en)} className="p-2 rounded-xl bg-azure dark:bg-carolina/15 text-sapphire dark:text-carolina active:scale-90" title={t.lib_listen}>
                  <Volume2 size={16} />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <button onClick={() => (locked ? needFull(t.lib_lock_edit) : openEdit(c))} title={locked ? t.lib_lock_title : t.lib_edit} className="flex-1 inline-flex justify-center items-center gap-1 text-xs font-bold px-2 py-2 rounded-xl border border-slate-200 dark:border-white/10 active:scale-95">
                  {locked ? <Lock size={13} /> : <Pencil size={13} />} {t.lib_edit}
                </button>
                <button onClick={() => (locked ? needFull(t.lib_lock_pile) : movePile(c.id, c.pile === 'known' ? 'learning' : 'known'))} title={locked ? t.lib_lock_title : c.pile === 'known' ? `${t.lib_to_known} ${t.pile_learning}` : `${t.lib_to_learning} ${t.pile_known}`} className="flex-1 inline-flex justify-center items-center gap-1 text-xs font-bold px-2 py-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 active:scale-95">
                  {locked ? <Lock size={13} /> : <RotateCcw size={13} />} {c.pile === 'known' ? t.lib_rever : t.pile_known}
                </button>
                <button onClick={() => (locked ? needFull(t.lib_lock_del) : (confirm(`${t.lib_del_confirm} "${c.en}"?`) && removeCard(c.id)))} title={locked ? t.lib_lock_title : t.lib_del} className="p-2 rounded-xl bg-rose-500/10 text-rose-500 active:scale-95">{locked ? <Lock size={15} /> : <Trash2 size={15} />}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && <p className="text-center text-slate-500 py-10">{t.lib_empty}</p>}

      {/* Modal de edição */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div className="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-black text-lg">{editing.id ? t.lib_edit_title : t.lib_new_title}</h3>
              <button onClick={() => setEditing(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-bold">{t.lib_f_en}<input value={editing.en} onChange={(e) => { setEditing({ ...editing, en: capFirst(e.target.value) }); setForceDup(false); }} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" placeholder="Water" /></label>
              <label className="text-xs font-bold">{t.lib_f_pt}<input value={editing.pt} onChange={(e) => setEditing({ ...editing, pt: capFirst(e.target.value) })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" placeholder="Água" /></label>
              <div className="col-span-2">
                <button onClick={() => void fetchAI()} disabled={aiBusy || (!editing.en.trim() && !editing.pt.trim())} className="w-full px-3 py-2 rounded-xl bg-gradient-to-r from-sapphire to-carolina text-white text-xs font-black active:scale-[0.98] disabled:opacity-50">
                  {aiBusy ? t.lib_ai_busy : t.lib_ai_btn}
                </button>
                {aiMsg && <p className="mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">{aiMsg}</p>}
              </div>
              <label className="text-xs font-bold">{t.lib_f_say}<input value={editing.phoneticBR} onChange={(e) => setEditing({ ...editing, phoneticBR: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" placeholder="uóra" /></label>
              <label className="text-xs font-bold">{t.lib_f_ipa}<input value={editing.ipa} onChange={(e) => setEditing({ ...editing, ipa: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" placeholder="/ˈwɔːtər/" /></label>
              <label className="text-xs font-bold col-span-2">{t.lib_f_exen}<input value={editing.exampleEN} onChange={(e) => setEditing({ ...editing, exampleEN: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" placeholder="Can I have some water?" /></label>
              <label className="text-xs font-bold col-span-2">{t.lib_f_expt}<input value={editing.examplePT} onChange={(e) => setEditing({ ...editing, examplePT: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" placeholder="Posso beber água?" /></label>
              <label className="text-xs font-bold">{t.lib_f_cat}<input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" /></label>
              <div className="text-xs font-bold">{t.lib_f_photo}
                <div className="mt-1 flex gap-2">
                  <button onClick={() => photoRef.current?.click()} disabled={photoBusy} className="flex-1 px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-white/20 text-xs font-bold active:scale-95 disabled:opacity-50">📷 {photoBusy ? (user ? t.lib_photo_busy : t.lib_photo_sending) : (editing.photo || editing.photoUrl) ? t.lib_photo_change : t.lib_photo_send}</button>
                  {(editing.photo || editing.photoUrl) && <button onClick={() => setEditing({ ...editing, photo: '', photoUrl: '' })} className="px-3 py-2 rounded-xl bg-rose-500/10 text-rose-500 text-xs font-bold">{t.lib_clear}</button>}
                </div>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
              </div>
            </div>
            <div className="text-xs font-bold mt-3">{t.lib_emoji}
              <div className="mt-1">
                <EmojiPicker value={editing.emoji} onPick={(emoji) => setEditing({ ...editing, emoji })} />
              </div>
            </div>
            <div className="text-xs font-bold mt-3">{t.lib_color}
              <p className="text-[10px] font-bold text-slate-400 mt-2 mb-1">Azuis</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {GRADIENTS.map((g) => (
                  <button key={g} onClick={() => setEditing({ ...editing, gradient: g })} title={g} className={`w-10 h-10 rounded-xl bg-gradient-to-br ${g} ${editing.gradient === g ? 'ring-2 ring-offset-2 ring-carolina' : ''}`} />
                ))}
              </div>
              <p className="text-[10px] font-bold text-slate-400 mt-2 mb-1">Clássicas</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CLASSIC_GRADIENTS.map((g) => (
                  <button key={g} onClick={() => setEditing({ ...editing, gradient: g })} title={g} className={`w-10 h-10 rounded-xl bg-gradient-to-br ${g} ${editing.gradient === g ? 'ring-2 ring-offset-2 ring-carolina' : ''}`} />
                ))}
              </div>
            </div>
            {(editing.photoUrl || editing.photo) && (
              <div className={`mt-3 w-full h-32 rounded-2xl overflow-hidden relative bg-gradient-to-br ${editing.gradient} flex items-center justify-center`}>
                <img src={editing.photoUrl || editing.photo} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-60" />
                <img src={editing.photoUrl || editing.photo} alt="preview" className="relative max-w-full max-h-full object-contain drop-shadow" />
              </div>
            )}
            {liveDup && !forceDup && (
              <div className="mt-3 px-3 py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-300">
                ⚠️ "{liveDup.en}" {t.lib_dup_warn} ({liveDup.pt} · {liveDup.pile === 'new' ? t.pill_new : liveDup.pile === 'known' ? t.pile_known : t.pile_learning}).
                <button
                  onClick={() => { setQ(liveDup.en); setEditing(null); }}
                  className="ml-2 underline"
                >
                  {t.lib_dup_view}
                </button>
              </div>
            )}
            <button onClick={saveForm} disabled={!editing.en.trim() || !editing.pt.trim()} className="mt-4 w-full py-3 rounded-2xl bg-sapphire text-white font-black disabled:opacity-40 hover:bg-celadon active:scale-[0.98]">
              💾 {liveDup && !editing.id && !forceDup ? t.lib_save_anyway : t.lib_save}
            </button>
            {liveDup && !editing.id && !forceDup && (
              <button onClick={() => setForceDup(true)} className="mt-2 w-full py-2 rounded-2xl border border-amber-300 dark:border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs font-black active:scale-[0.98]">
                {t.lib_save_dup_confirm}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
