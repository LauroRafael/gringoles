// Gringolês — tts-proxy v4 (100% grátis, sem chave).
// POST { text, lang: "en"|"pt", voice?, rate? } → audio/mpeg
// 1) msedge-tts (Voz neural Microsoft M/F via Read Aloud API) — X-TTS-Engine: edge-neural
// 2) Fallback Google Translate TTS (mesmo contrato) — X-TTS-Engine: google
// Textos > 200 chars devem ser fatiados pelo cliente (audio.ts).
// Rate é aplicado no cliente (Audio.playbackRate) — o proxy ignora o param.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'npm:msedge-tts@2.0.7';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EN_VOICES = new Set(['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural']);
const PT_VOICES = new Set(['pt-BR-FranciscaNeural', 'pt-BR-AntonioNeural']);

function pickVoice(lang: string, want: string): { voice: string; locale: string } {
  if (lang === 'pt') {
    const voice = PT_VOICES.has(want) ? want : 'pt-BR-FranciscaNeural';
    return { voice, locale: 'pt-BR' };
  }
  const voice = EN_VOICES.has(want) ? want : 'en-US-AriaNeural';
  return { voice, locale: 'en-US' };
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Síntese neural via pacote msedge-tts (escreve mp3 temporário e devolve os bytes). */
async function neuralTts(text: string, voice: string): Promise<Uint8Array> {
  const tmp = `/tmp/tts-${crypto.randomUUID()}.mp3`;
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    await tts.toFile(tmp, escXml(text));
    const bytes = await Deno.readFile(tmp);
    if (!bytes.length) throw new Error('empty neural audio');
    return bytes;
  } finally {
    try {
      await Deno.remove(tmp);
    } catch { /* noop */ }
  }
}

/** Fallback: Google Translate TTS (sem chave). */
async function googleTts(text: string, tl: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&q=${encodeURIComponent(text)}&client=tw-ob`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
        'Referer': 'https://translate.google.com/',
        'Accept': 'audio/mpeg,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`google upstream ${res.status}`);
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error('google empty audio');
  return buf;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  let body: { text?: string; lang?: string; voice?: string; rate?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const text = String(body?.text ?? '').trim().slice(0, 200);
  if (!text) {
    return new Response(JSON.stringify({ error: 'empty text' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const lang = body?.lang === 'pt' ? 'pt' : 'en';
  const { voice } = pickVoice(lang, String(body?.voice ?? ''));
  const tl = lang === 'pt' ? 'pt-BR' : 'en-US';

  try {
    const mp3 = await neuralTts(text, voice);
    return new Response(mp3.buffer as ArrayBuffer, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000', 'X-TTS-Engine': 'edge-neural' },
    });
  } catch (e) {
    console.error('[tts-proxy] neural failed:', String((e as Error)?.stack ?? e));
    try {
      const buf = await googleTts(text, tl);
      return new Response(buf, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000', 'X-TTS-Engine': 'google' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  }
});
