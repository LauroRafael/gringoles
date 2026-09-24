/** TTS em camadas: 1) Piper neural offline (se motor ativo e voz baixada) →
 * 2) mp3 em cache (Storage tts-cache) via Edge tts-proxy → 3) Web Speech API local.
 * 100% grátis, sem chave. Falhou tudo? A voz local assume sem quebrar.
 * Textos longos são fatiados em ~180 chars (limite do proxy) e tocados em sequência.
 */
import { supabase } from './supabase';
import { speakEN, speakPT, speakExamplePair, stopSpeak } from './speech';
import { useStore } from '../store/useStore';

type PiperSession = { predict: (text: string) => Promise<Blob> };
type PiperProgress = { url?: string; loaded?: number; total?: number };
let piperMod: typeof import('@realtimex/piper-tts-web') | null = null;
const piperSessions = new Map<string, PiperSession>();
/** Voz cujo modelo está carregado no singleton TtsSession (a lib reaproveita a
 *  instância sem recarregar o modelo — trocar de voz exige reset explícito). */
let piperLoadedVoice: string | null = null;

async function loadPiper() {
  if (!piperMod) piperMod = await import('@realtimex/piper-tts-web');
  return piperMod;
}

/** Devolve a sessão da voz pedida, recarregando o modelo ao trocar de voz. */
async function piperSessionFor(voiceId: string): Promise<PiperSession> {
  const mod = await loadPiper();
  if (piperLoadedVoice !== voiceId) {
    try {
      (mod.TtsSession as unknown as { _instance?: unknown })._instance = undefined;
    } catch { /* noop */ }
    piperSessions.clear();
    piperLoadedVoice = null;
  }
  let session = piperSessions.get(voiceId);
  if (!session) {
    session = new mod.TtsSession({ voiceId, fallbackStrategy: 'auto' }) as PiperSession;
    piperSessions.set(voiceId, session);
    piperLoadedVoice = voiceId;
  }
  return session;
}

/** Vozes Piper já baixadas neste aparelho (Origin private file system). */
export async function piperStoredVoices(): Promise<string[]> {
  try {
    const mod = await loadPiper();
    const list = (await mod.stored()) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

/** Baixa a voz Piper (~60MB, uma vez só — depois fica em cache offline). */
export async function downloadPiperVoice(voiceId: string, onProgress?: (pct: number) => void): Promise<boolean> {
  try {
    const mod = await loadPiper();
    await mod.download(voiceId, (p: unknown) => {
      const prog = p as PiperProgress;
      if (onProgress && prog.total) onProgress(Math.round(((prog.loaded ?? 0) * 100) / prog.total));
    });
    piperSessions.delete(voiceId);
    if (piperLoadedVoice === voiceId) piperLoadedVoice = null;
    return true;
  } catch {
    return false;
  }
}

/** Apaga a voz baixada para liberar espaço (~60MB). */
export async function removePiperVoice(voiceId: string): Promise<void> {
  try {
    const mod = await loadPiper();
    await mod.remove(voiceId);
  } catch { /* noop */ }
  piperSessions.delete(voiceId);
  if (piperLoadedVoice === voiceId) piperLoadedVoice = null;
}

/** Sintetiza via Piper local. true se tocou tudo; false = modelo ausente/falha. */
async function piperSynth(text: string, voiceId: string, rate: number): Promise<boolean> {
  const token = seqToken;
  try {
    const stored = await piperStoredVoices();
    if (!stored.includes(voiceId)) return false;
    const session = await piperSessionFor(voiceId);
    for (const part of chunk(text)) {
      if (token !== seqToken) return false;
      const wav = await session.predict(part);
      if (token !== seqToken) return false;
      const url = URL.createObjectURL(wav);
      try {
        const ok = await playUrl(url, rate, token);
        if (!ok) return false;
        markEngine(`piper:${voiceId}`);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    }
    return true;
  } catch {
    piperSessions.delete(voiceId);
    if (piperLoadedVoice === voiceId) piperLoadedVoice = null;
    return false;
  }
}

let currentAudio: HTMLAudioElement | null = null;
let seqToken = 0;
/** De onde veio o último áudio tocado (diagnóstico visível no Admin). */
let lastEngineUsed = '—';

export function lastEngine(): string {
  return lastEngineUsed;
}

function markEngine(e: string): void {
  lastEngineUsed = e;
  try {
    console.info(`[tts] engine=${e}`);
  } catch { /* noop */ }
}

export function stopAudio(): void {
  seqToken += 1;
  try {
    currentAudio?.pause();
  } catch { /* noop */ }
  currentAudio = null;
  stopSpeak();
}

function hashKey(text: string, lang: 'en' | 'pt'): string {
  let h = 0;
  const s = `${lang}:${text.trim().toLowerCase()}`;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return `${lang}-${(h >>> 0).toString(36)}-${text.trim().length}`;
}

/** Fatia em ≤180 chars, preferindo fronteira de frase/espaço. */
function chunk(text: string, max = 180): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max);
    if (cut < 60) cut = rest.lastIndexOf(', ', max);
    if (cut < 60) cut = rest.lastIndexOf(' ', max);
    if (cut < 60) cut = max;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

function playUrl(url: string, rate: number, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (token !== seqToken) return resolve(false);
    try {
      const a = new Audio(url);
      a.playbackRate = rate;
      a.preload = 'auto';
      currentAudio = a;
      a.onended = () => {
        if (currentAudio === a) currentAudio = null;
        resolve(true);
      };
      a.onerror = () => {
        if (currentAudio === a) currentAudio = null;
        resolve(false);
      };
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => resolve(false));
      }
    } catch {
      resolve(false);
    }
  });
}

async function fetchProxyMp3(text: string, lang: 'en' | 'pt'): Promise<Blob | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('tts-proxy', { body: { text, lang } });
    if (error) return null;
    // supabase-js retorna Response quando content-type não é json — normaliza para Blob.
    if (data instanceof Blob) return data;
    if (data instanceof ArrayBuffer) return new Blob([data], { type: 'audio/mpeg' });
    if (typeof data === 'string') {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'audio/mpeg' });
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheUrl(key: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = supabase.storage.from('tts-cache').getPublicUrl(`${key}.mp3`);
    const res = await fetch(data.publicUrl, { method: 'HEAD' });
    return res.ok ? data.publicUrl : null;
  } catch {
    return null;
  }
}

async function cacheUpload(key: string, blob: Blob): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { error } = await supabase.storage.from('tts-cache').upload(`${key}.mp3`, blob, {
      contentType: 'audio/mpeg',
      upsert: true,
    });
    if (error) return null;
    const { data } = supabase.storage.from('tts-cache').getPublicUrl(`${key}.mp3`);
    return data.publicUrl;
  } catch {
    return null;
  }
}

/** Toca um texto: Piper local → cache → proxy → fallback local. Retorna true se tocou tudo. */
async function playText(text: string, lang: 'en' | 'pt', rate = 1): Promise<boolean> {
  const token = seqToken;
  const st = useStore.getState();
  // 1) Piper neural offline (só se o modelo já está baixado — sem download surpresa)
  if (st.ttsEngine === 'piper') {
    const voice = lang === 'en' ? st.ttsVoiceEN : st.ttsVoicePT;
    if (token === seqToken && await piperSynth(text, voice, rate)) return true;
    if (token !== seqToken) return false;
  }
  const parts = chunk(text);
  for (const part of parts) {
    if (token !== seqToken) return false;
    const key = hashKey(part, lang);
    let played = false;
    const hit = await cacheUrl(key);
    if (hit && token === seqToken) {
      played = await playUrl(hit, rate, token);
      if (played) markEngine('proxy:cache');
    }
    if (!played && token === seqToken) {
      const blob = await fetchProxyMp3(part, lang);
      if (blob && token === seqToken) {
        // Demo (sem login) não pode subir ao bucket — toca o blob direto.
        const stored = await cacheUpload(key, blob);
        const objUrl = URL.createObjectURL(blob);
        played = await playUrl(stored ?? objUrl, rate, token);
        if (played) markEngine(stored ? 'proxy:cache-new' : 'proxy:direto');
        if (!stored) window.setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      }
    }
    if (!played) return false;
  }
  return true;
}

function fallback(text: string, lang: 'en' | 'pt', slow: boolean): void {
  markEngine('local:sistema');
  if (lang === 'en') speakEN(text, slow);
  else speakPT(text);
}

/** Ouve palavra em inglês (normal ou devagar). */
export function playEN(text: string, slow = false): void {
  stopAudio();
  const token = seqToken;
  const baseRate = useStore.getState().ttsRate || 1;
  void (async () => {
    const ok = await playText(text, 'en', slow ? 0.6 : baseRate);
    if (!ok && token === seqToken) fallback(text, 'en', slow);
  })();
}

/** Ouve texto em português. */
export function playPT(text: string): void {
  stopAudio();
  const token = seqToken;
  const baseRate = useStore.getState().ttsRate || 1;
  void (async () => {
    const ok = await playText(text, 'pt', baseRate);
    if (!ok && token === seqToken) fallback(text, 'pt', false);
  })();
}

/** Ouve exemplo EN→PT com a mesma semântica do speakExamplePair. */
export function playExamplePair(exampleEN: string, examplePT: string): void {
  stopAudio();
  const token = seqToken;
  void (async () => {
    const okEN = await playText(exampleEN, 'en', 1);
    if (token !== seqToken) return;
    if (!okEN) {
      markEngine('local:sistema');
      speakExamplePair(exampleEN, examplePT);
      return;
    }
    const okPT = await playText(examplePT, 'pt', 1);
    if (!okPT && token === seqToken) {
      markEngine('local:sistema');
      speakExamplePair(exampleEN, examplePT);
    }
  })();
}
