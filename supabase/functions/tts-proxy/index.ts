// Gringolês — tts-proxy v2 (100% grátis, sem chave).
// POST { text, lang: "en"|"pt", voice?, rate? } → audio/mpeg
// 1) Tenta Microsoft Edge-TTS neural (vozes M/F, rate via SSML).
// 2) Falhou? Cai para o Google Translate TTS (mesmo contrato).
// Textos > 200 chars devem ser fatiados pelo cliente (audio.ts).

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TRUSTED_TOKEN = '6A5AA1D4EAFF9B9FB4B37E55D72BF5C';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_TOKEN}`;

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

function clampRate(r: unknown): number {
  const n = Number(r);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.5, Math.max(0.5, n));
}

function rateToProsody(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return pct === 0 ? '+0%' : pct > 0 ? `+${pct}%` : `${pct}%`;
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Sec-MS-GEC: SHA256(ticks arredondados + token), como o Edge faz. */
async function secMsGec(): Promise<string> {
  const ticks = Math.floor(((Date.now() / 1000 + 11644473600) * 1e7) / 300000000) * 300000000;
  const data = new TextEncoder().encode(`${ticks}${TRUSTED_TOKEN}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function utcStamp(d = new Date()): string {
  return d.toUTCString();
}

/** Síntese via Edge-TTS (WebSocket). Resolve com os bytes do MP3. */
function edgeTts(ssml: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let done = false;
    const chunks: Uint8Array[] = [];
    let ws: WebSocket;
    const fail = (e: unknown) => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch { /* noop */ }
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const finish = () => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch { /* noop */ }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (!total) {
        reject(new Error('empty edge audio'));
        return;
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      resolve(out);
    };
    const timer = setTimeout(() => fail(new Error('edge timeout')), 20000);
    void (async () => {
      try {
        const gec = await secMsGec();
        ws = new WebSocket(WSS_URL, {
          // @ts-ignore Headers extras — suportado no Deno (não no browser)
          headers: {
            'Origin': 'chrome-extension://jdicclakoogkdmldbiibdgkmjlapnomm',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
            'Sec-MS-GEC': gec,
            'Sec-MS-GEC-Version': '1-132.0.2913.1',
          },
        } as unknown as string[]);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          try {
            const stamp = utcStamp();
            ws.send(
              `X-Timestamp:${stamp}\r\nContent-Type: application/json; charset=utf-8\r\nPath: speech.config\r\n\r\n` +
              JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }),
            );
            const reqId = crypto.randomUUID().replace(/-/g, '');
            ws.send(
              `X-RequestId:${reqId}\r\nContent-Type: application/ssml+xml\r\nX-Timestamp:${stamp}\r\nPath: ssml\r\n\r\n${ssml}`,
            );
          } catch (e) {
            fail(e);
          }
        };
        ws.onmessage = (ev: MessageEvent) => {
          try {
            const data = ev.data as unknown;
            if (typeof data === 'string') {
              if (data.includes('Path:turn.end')) {
                clearTimeout(timer);
                finish();
              } else if (data.includes('Path:turn.start')) {
                // início — nada a fazer
              }
              return;
            }
            const buf = new Uint8Array(data as ArrayBuffer);
            if (buf.length < 2) return;
            const headerLen = (buf[0] << 8) | buf[1];
            const header = new TextDecoder().decode(buf.slice(2, 2 + headerLen));
            if (header.includes('Path:audio')) {
              chunks.push(buf.slice(2 + headerLen));
            }
          } catch (e) {
            fail(e);
          }
        };
        ws.onerror = () => fail(new Error('edge ws error'));
        ws.onclose = () => {
          // Fechou antes do turn.end: entrega o que juntou (se algo), senão falha.
          if (!done) {
            clearTimeout(timer);
            finish();
          }
        };
      } catch (e) {
        clearTimeout(timer);
        fail(e);
      }
    })();
  });
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
  const { voice, locale } = pickVoice(lang, String(body?.voice ?? ''));
  const rate = clampRate(body?.rate);
  const tl = lang === 'pt' ? 'pt-BR' : 'en-US';

  // 1) Edge neural
  try {
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
      `<voice name='${voice}'><prosody rate='${rateToProsody(rate)}' pitch='+0Hz'>${escXml(text)}</prosody></voice></speak>`;
    const mp3 = await edgeTts(ssml);
    return new Response(mp3.buffer as ArrayBuffer, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000', 'X-TTS-Engine': 'edge' },
    });
  } catch {
    // 2) Fallback Google (mesmo contrato)
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
