import { useEffect, useState } from 'react';
import { ShieldCheck, Trash2, RotateCcw, Users, BookOpen, CalendarDays, Plus, Pencil, Power, Ban, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { STRINGS } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { playEN, playPT, downloadPiperVoice, piperStoredVoices, removePiperVoice, lastEngine } from '../lib/audio';

interface Profile {
  id: string;
  display_name: string | null;
  role: string;
  xp: number;
  created_at: string;
  is_blocked: boolean;
}

interface BankRow {
  bank_id: string; en: string; pt: string; phonetic_br: string; ipa: string;
  example_en: string; example_pt: string; emoji: string; category: string; active: boolean;
}

/** Vozes neurais offline (Piper, MIT) — IDs exatos do pacote. */
const PIPER_EN = [
  { id: 'en_US-amy-medium', label: 'Amy · feminina' },
  { id: 'en_US-lessac-medium', label: 'Lessac · feminina' },
  { id: 'en_US-ryan-medium', label: 'Ryan · masculina' },
  { id: 'en_US-danny-low', label: 'Danny · masculina · leve' },
];
const PIPER_PT = [
  { id: 'pt_BR-faber-medium', label: 'Faber' },
  { id: 'pt_BR-edresson-low', label: 'Edresson · leve' },
];

export default function AdminPanel() {
  const { role, user, newPerDay, setNewPerDay, autoNewPerDay, setAutoNewPerDay,
    autoAddEnabled, setAutoAddEnabled, autoAddTimes, setAutoAddTimes,
    demoMax, setDemoMax, adminCreateUser, manageUser, lang,
    ttsEngine, setTtsEngine, ttsVoiceEN, setTtsVoiceEN, ttsVoicePT, setTtsVoicePT,
    ttsRate, setTtsRate } = useStore();
  const t = STRINGS[lang];
  const [nuName, setNuName] = useState('');
  const [nuEmail, setNuEmail] = useState('');
  const [nuPass, setNuPass] = useState('');
  const db = () => {
    if (!supabase) throw new Error('Supabase não configurado.');
    return supabase;
  };
  const [users, setUsers] = useState<Profile[]>([]);
  const [counts, setCounts] = useState({ cards: 0, days: 0, bank: 0 });
  const [bank, setBank] = useState<BankRow[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [storedVoices, setStoredVoices] = useState<string[]>([]);
  const [dlPct, setDlPct] = useState<Record<string, number>>({});
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [lastTts, setLastTts] = useState('—');

  const testEN = () => {
    playEN('Hello! This is my English voice.');
    window.setTimeout(() => setLastTts(lastEngine()), 2500);
  };
  const testPT = () => {
    playPT('Olá! Esta é minha voz em português.');
    window.setTimeout(() => setLastTts(lastEngine()), 2500);
  };
  const [editingBank, setEditingBank] = useState<Partial<BankRow> & { isNew?: boolean } | null>(null);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 5000);
  };

  const reload = async () => {
    if (!supabase) return;
    const [u, c, d, b] = await Promise.all([
      db().from('profiles').select('id,display_name,role,xp,created_at,is_blocked').order('created_at', { ascending: false }).limit(200),
      db().from('cards').select('id', { count: 'exact', head: true }),
      db().from('study_days').select('studied', { count: 'exact', head: true }),
      db().from('word_bank').select('*').order('bank_id').limit(1000),
    ]);
    if (u.data) setUsers(u.data as Profile[]);
    setCounts({ cards: c.count ?? 0, days: d.count ?? 0, bank: (b.data as BankRow[] | null)?.length ?? 0 });
    if (b.data) setBank(b.data as BankRow[]);
  };

  useEffect(() => {
    void reload();
    void piperStoredVoices().then(setStoredVoices).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (role !== 'admin' || !supabase) return <p className="text-center py-10 text-slate-500">{t.adm_denied}</p>;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await reload();
    } catch (e) {
      flash(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const resetUser = (id: string, name: string) =>
    run(`reset-${id}`, async () => {
      if (!confirm(`${t.adm_zero_confirm} ${name}?`)) return;
      const d1 = await db().from('cards').delete().eq('user_id', id);
      if (d1.error) throw d1.error;
      const d2 = await db().from('study_days').delete().eq('user_id', id);
      if (d2.error) throw d2.error;
      const d3 = await db().from('profiles').update({ xp: 0, day_streak: 0, best_streak: 0, last_study_date: '' }).eq('id', id);
      if (d3.error) throw d3.error;
      flash(`✅ ${t.adm_zero_done} ${name} ${t.adm_zero_done_end}`);
    });

  const setRole = (id: string, name: string, next: string) =>
    run(`role-${id}`, async () => {
      if (!confirm(`${next === 'admin' ? t.adm_role_confirm_promote : t.adm_role_confirm_degrade} ${name} ${next === 'admin' ? t.adm_role_to_admin : t.adm_role_to_user}?`)) return;
      const { error } = await db().from('profiles').update({ role: next }).eq('id', id);
      if (error) throw error;
      flash(`✅ ${name} ${t.adm_role_done} ${next}.`);
    });

  const toggleBlock = (id: string, name: string, blocked: boolean) =>
    run(`block-${id}`, async () => {
      if (!confirm(blocked ? `${t.adm_unblock_confirm} ${name}?` : `${t.adm_block_confirm} ${name}?`)) return;
      const res = await manageUser(blocked ? 'unblock' : 'block', id);
      flash(res.msg);
    });

  const deleteUser = (id: string, name: string) =>
    run(`del-${id}`, async () => {
      if (!confirm(`${t.adm_del_confirm} ${name}? ${t.adm_del_irreversible}`)) return;
      const res = await manageUser('delete', id);
      flash(res.msg);
    });

  const ensureVoice = async (id: string) => {
    setDlBusy(id);
    setDlPct((p) => ({ ...p, [id]: 0 }));
    try {
      const ok = await downloadPiperVoice(id, (pct) => setDlPct((p) => ({ ...p, [id]: pct })));
      const stored = await piperStoredVoices().catch(() => [] as string[]);
      setStoredVoices(stored);
      flash(ok ? `✅ ${t.adm_tts_downloaded}` : `❌ ${t.adm_tts_download_fail}`);
    } finally {
      setDlBusy(null);
    }
  };

  const dropVoice = async (id: string) => {
    if (!confirm(`${t.adm_tts_remove_confirm}`)) return;
    await removePiperVoice(id);
    setStoredVoices(await piperStoredVoices().catch(() => [] as string[]));
  };

  const saveBank = () =>
    run('bank-save', async () => {
      if (!editingBank || !editingBank.en?.trim() || !editingBank.pt?.trim()) return;
      if (editingBank.isNew) {
        const bank_id = `custom-${Date.now().toString(36)}`;
        const { error } = await db().from('word_bank').insert({
          bank_id, en: editingBank.en.trim(), pt: editingBank.pt.trim(),
          phonetic_br: editingBank.phonetic_br ?? '', ipa: editingBank.ipa ?? '',
          example_en: editingBank.example_en ?? '', example_pt: editingBank.example_pt ?? '',
          emoji: editingBank.emoji || '📚', category: editingBank.category || 'Banco', active: true,
        });
        if (error) throw error;
      } else {
        const { bank_id, isNew: _drop, ...patch } = editingBank;
        void _drop;
        const { error } = await db().from('word_bank').update(patch).eq('bank_id', bank_id);
        if (error) throw error;
      }
      setEditingBank(null);
      flash(t.adm_bank_saved);
    });

  const toggleBank = (row: BankRow) =>
    run(`bank-${row.bank_id}`, async () => {
      const { error } = await db().from('word_bank').update({ active: !row.active }).eq('bank_id', row.bank_id);
      if (error) throw error;
    });

  const filteredBank = bank.filter((b) => {
    const n = q.trim().toLowerCase();
    if (!n) return true;
    return (b.en + ' ' + b.pt + ' ' + b.category).toLowerCase().includes(n);
  });

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl p-5 bg-gradient-to-br from-prussian to-[#0a1c2c] text-white">
        <p className="font-black text-sm inline-flex items-center gap-1"><ShieldCheck size={15} /> {t.adm_title}</p>
        <div className="flex gap-5 mt-3 flex-wrap">
          <div><p className="text-2xl font-black inline-flex items-center gap-1"><Users size={18} />{users.length}</p><p className="text-xs opacity-70">{t.adm_users}</p></div>
          <div><p className="text-2xl font-black inline-flex items-center gap-1"><BookOpen size={18} />{counts.cards}</p><p className="text-xs opacity-70">{t.adm_cards}</p></div>
          <div><p className="text-2xl font-black inline-flex items-center gap-1"><CalendarDays size={18} />{counts.days}</p><p className="text-xs opacity-70">{t.adm_days}</p></div>
          <div><p className="text-2xl font-black">📚 {counts.bank}</p><p className="text-xs opacity-70">{t.adm_bank}</p></div>
        </div>
      </div>

      {msg && <div className="px-4 py-2.5 rounded-2xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 text-sm font-bold animate-pop-in">{msg}</div>}

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <p className="font-black text-sm mb-3">{t.adm_cfg}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="font-bold">{t.adm_cfg_queue}
            <input type="number" min={5} max={100} value={newPerDay} onChange={(e) => setNewPerDay(Number(e.target.value) || 20)} className="ml-2 w-20 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" />
          </label>
          <label className="font-bold inline-flex items-center gap-2">
            <button
              role="switch"
              aria-checked={autoAddEnabled}
              onClick={() => setAutoAddEnabled(!autoAddEnabled)}
              className={`w-11 h-6 rounded-full p-1 transition ${autoAddEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/15'}`}
            >
              <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${autoAddEnabled ? 'translate-x-5' : ''}`} />
            </button>
            {t.adm_cfg_auto}
            <input type="number" min={0} max={30} value={autoNewPerDay} onChange={(e) => setAutoNewPerDay(Math.max(0, Number(e.target.value) || 0))} className="w-16 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" />
          </label>
          <label className="font-bold inline-flex items-center gap-2">⏰ {t.adm_cfg_times}
            {[0, 1].map((i) => (
              <input
                key={i}
                type="time"
                value={(autoAddTimes ?? [])[i] ?? ''}
                onChange={(e) => {
                  const next = [...(autoAddTimes ?? [])];
                  next[i] = e.target.value;
                  setAutoAddTimes(next.filter(Boolean));
                }}
                className="px-2 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent"
              />
            ))}
          </label>
          <label className="font-bold">{t.adm_cfg_cap}
            <input type="number" min={1} max={10000} value={demoMax} onChange={(e) => setDemoMax(Number(e.target.value) || 100)} className="ml-2 w-20 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" />
          </label>
          <span className="text-xs text-slate-500">{t.adm_cfg_note}</span>
        </div>
      </div>

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <p className="font-black text-sm mb-1">🔊 {t.adm_tts}</p>
        <p className="text-xs text-slate-500 mb-3">{t.adm_tts_sub}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden" role="radiogroup" aria-label={t.adm_tts}>
            {(['proxy', 'piper'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setTtsEngine(e)}
                aria-pressed={ttsEngine === e}
                className={`px-3 py-2 text-xs font-black active:scale-95 ${ttsEngine === e ? 'bg-sapphire text-white' : 'opacity-70'}`}
              >
                {e === 'proxy' ? `☁️ ${t.adm_tts_cloud}` : `📴 ${t.adm_tts_piper}`}
              </button>
            ))}
          </div>
          <label className="font-bold">🇺🇸
            <select value={ttsVoiceEN} onChange={(e) => setTtsVoiceEN(e.target.value)} className="ml-2 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-xs">
              {PIPER_EN.map((v) => (
                <option key={v.id} value={v.id}>{v.label}{storedVoices.includes(v.id) ? ' ✅' : ''}</option>
              ))}
            </select>
          </label>
          <label className="font-bold">🇧🇷
            <select value={ttsVoicePT} onChange={(e) => setTtsVoicePT(e.target.value)} className="ml-2 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-xs">
              {PIPER_PT.map((v) => (
                <option key={v.id} value={v.id}>{v.label}{storedVoices.includes(v.id) ? ' ✅' : ''}</option>
              ))}
            </select>
          </label>
          <label className="font-bold inline-flex items-center gap-2">{t.adm_tts_rate}
            <input type="range" min={0.5} max={1.5} step={0.1} value={ttsRate} onChange={(e) => setTtsRate(Number(e.target.value))} className="w-28" />
            <span className="text-xs tabular-nums w-8">{ttsRate.toFixed(1)}x</span>
          </label>
          <button onClick={testEN} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black active:scale-95">▶ 🇺🇸 {t.adm_tts_test}</button>
          <button onClick={testPT} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black active:scale-95">▶ 🇧🇷 {t.adm_tts_test}</button>
          <span className="text-[11px] text-slate-400">🎙️ {t.adm_tts_last}: <b>{lastTts}</b></span>
        </div>
        {ttsEngine === 'piper' && (
          <div className="mt-3 grid gap-1.5">
            {[ttsVoiceEN, ttsVoicePT].map((id) => {
              const has = storedVoices.includes(id);
              const busyDl = dlBusy === id;
              return (
                <div key={id} className="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5">
                  <span className="flex-1 truncate">{id} {has ? `· ✅ ${t.adm_tts_downloaded}` : `· ⬇️ ~60MB`}</span>
                  {!has && (
                    <button disabled={dlBusy !== null} onClick={() => void ensureVoice(id)} className="px-3 py-1.5 rounded-lg bg-sapphire text-white font-black disabled:opacity-50 active:scale-95">
                      {busyDl ? `${t.adm_tts_downloading} ${dlPct[id] ?? 0}%` : `⬇️ ${t.adm_tts_download}`}
                    </button>
                  )}
                  {has && (
                    <button onClick={() => void dropVoice(id)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 active:scale-95">
                      🗑 {t.adm_tts_remove}
                    </button>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-slate-400">{t.adm_tts_size_note}</p>
          </div>
        )}
      </div>

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <p className="font-black text-sm mb-1">{t.adm_add_user}</p>
        <p className="text-xs text-slate-500 mb-3">{t.adm_add_sub}</p>
        <div className="grid sm:grid-cols-4 gap-2 text-xs font-bold">
          <label>{t.adm_f_name}<input value={nuName} onChange={(e) => setNuName(e.target.value)} placeholder="Nome" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
          <label>{t.adm_f_email}<input value={nuEmail} onChange={(e) => setNuEmail(e.target.value)} type="email" placeholder="aluno@email.com" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
          <label>{t.adm_f_pass}<input value={nuPass} onChange={(e) => setNuPass(e.target.value)} type="password" placeholder="••••••" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
          <div className="flex items-end">
            <button
              disabled={busy !== null}
              onClick={() => run('new-user', async () => {
                const res = await adminCreateUser(nuEmail, nuPass, nuName);
                flash(res.msg);
                if (res.ok) { setNuName(''); setNuEmail(''); setNuPass(''); }
              })}
              className="w-full px-3 py-2 rounded-xl bg-sapphire text-white text-xs font-black disabled:opacity-50 active:scale-95"
            >
              {busy === 'new-user' ? t.adm_creating : t.adm_create}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <p className="font-black text-sm mb-3">{t.adm_users_title}</p>
        <div className="grid gap-2">
          {users.map((u) => (
            <div key={u.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-2xl text-sm ${u.is_blocked ? 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20' : 'bg-slate-50 dark:bg-white/5'}`}>
              <span className="font-black">{u.display_name || '(sem nome)'}</span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-sapphire text-white' : 'bg-slate-200 dark:bg-white/10'}`}>{u.role}</span>
              {u.is_blocked && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500 text-white">⛔ {t.adm_blocked}</span>}
              <span className="text-xs text-slate-500">⚡{u.xp} XP</span>
              <span className="flex-1" />
              <button disabled={busy !== null} onClick={() => resetUser(u.id, u.display_name || u.id.slice(0, 8))} title="Zerar progresso" className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 disabled:opacity-50">
                <RotateCcw size={12} /> {busy === `reset-${u.id}` ? '...' : t.adm_zero}
              </button>
              <button disabled={busy !== null} onClick={() => setRole(u.id, u.display_name || u.id.slice(0, 8), u.role === 'admin' ? 'user' : 'admin')} title="Alternar papel" className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 disabled:opacity-50">
                <ShieldCheck size={12} /> {u.role === 'admin' ? t.adm_demote : t.adm_promote}
              </button>
              {u.id !== user?.id && (
                <>
                  <button disabled={busy !== null} onClick={() => toggleBlock(u.id, u.display_name || u.id.slice(0, 8), u.is_blocked)} title={u.is_blocked ? t.adm_unblock : t.adm_block} className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-xl border disabled:opacity-50 ${u.is_blocked ? 'border-emerald-300 text-emerald-600 dark:text-emerald-300' : 'border-rose-300 text-rose-600 dark:text-rose-300'}`}>
                    <Ban size={12} /> {busy === `block-${u.id}` ? '...' : u.is_blocked ? t.adm_unblock : t.adm_block}
                  </button>
                  <button disabled={busy !== null} onClick={() => deleteUser(u.id, u.display_name || u.id.slice(0, 8))} title={t.adm_delete_user} className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-xl bg-rose-500 text-white disabled:opacity-50">
                    <UserX size={12} /> {busy === `del-${u.id}` ? '...' : t.adm_delete_user}
                  </button>
                </>
              )}
            </div>
          ))}
          {users.length === 0 && <p className="text-sm text-slate-500">{t.adm_nousers}</p>}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">{t.adm_del_note}</p>
      </div>

      <div className="rounded-3xl p-5 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <div className="flex items-center gap-2 mb-3">
          <p className="font-black text-sm flex-1">{t.adm_bank_title}</p>
          <button onClick={() => setEditingBank({ isNew: true, en: '', pt: '', emoji: '📚', category: 'Banco' })} className="inline-flex items-center gap-1 text-xs font-black px-3 py-2 rounded-xl bg-sapphire text-white"><Plus size={13} /> {t.adm_bank_new}</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.adm_bank_search} className="w-full mb-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent text-sm" />
        <div className="grid gap-1.5 max-h-96 overflow-y-auto pr-1">
          {filteredBank.slice(0, 120).map((b) => (
            <div key={b.bank_id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm ${b.active ? 'bg-slate-50 dark:bg-white/5' : 'opacity-50 bg-slate-100 dark:bg-white/[0.02]'}`}>
              <span className="text-xl">{b.emoji}</span>
              <span className="font-bold">{b.en}</span>
              <span className="text-slate-500 text-xs truncate">{b.pt} · {b.category}</span>
              <span className="flex-1" />
              <button onClick={() => setEditingBank({ ...b })} title={t.adm_bank_edit} className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10"><Pencil size={13} /></button>
              <button onClick={() => toggleBank(b)} title={b.active ? t.adm_bank_off : t.adm_bank_on} className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10">
                <Power size={13} className={b.active ? 'text-emerald-500' : 'text-slate-400'} />
              </button>
            </div>
          ))}
        </div>
        {filteredBank.length > 120 && <p className="text-[11px] text-slate-400 mt-1">{t.adm_bank_show} 120 {t.adm_bank_show_of} {filteredBank.length} {t.adm_bank_refine}</p>}
      </div>

      {editingBank && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setEditingBank(null)}>
          <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-5 animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <p className="font-black mb-3">{editingBank.isNew ? t.adm_bank_new_title : `${t.adm_bank_edit_title} ${editingBank.en}`}</p>
            <div className="grid grid-cols-2 gap-2 text-xs font-bold">
              <label>EN*<input value={editingBank.en ?? ''} onChange={(e) => setEditingBank({ ...editingBank, en: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label>PT*<input value={editingBank.pt ?? ''} onChange={(e) => setEditingBank({ ...editingBank, pt: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label>Como se fala<input value={editingBank.phonetic_br ?? ''} onChange={(e) => setEditingBank({ ...editingBank, phonetic_br: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label>IPA<input value={editingBank.ipa ?? ''} onChange={(e) => setEditingBank({ ...editingBank, ipa: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label className="col-span-2">Exemplo EN<input value={editingBank.example_en ?? ''} onChange={(e) => setEditingBank({ ...editingBank, example_en: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label className="col-span-2">Exemplo PT<input value={editingBank.example_pt ?? ''} onChange={(e) => setEditingBank({ ...editingBank, example_pt: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label>Emoji<input value={editingBank.emoji ?? ''} onChange={(e) => setEditingBank({ ...editingBank, emoji: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
              <label>Categoria<input value={editingBank.category ?? ''} onChange={(e) => setEditingBank({ ...editingBank, category: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-transparent" /></label>
            </div>
            <button onClick={saveBank} disabled={busy !== null || !editingBank.en?.trim() || !editingBank.pt?.trim()} className="mt-3 w-full py-3 rounded-2xl bg-sapphire text-white font-black disabled:opacity-40">
              💾 {busy === 'bank-save' ? t.adm_bank_saving : t.adm_bank_save}
            </button>
            <button onClick={() => setEditingBank(null)} className="mt-2 w-full py-2 text-xs font-bold text-slate-500 flex items-center justify-center gap-1"><Trash2 size={12} /> {t.adm_bank_cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
