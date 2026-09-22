import { createClient } from 'jsr:@supabase/supabase-js@2';

const GROQ_KEY = Deno.env.get('GROQ_API_KEY');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const MODEL_PREFERENCE = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
];

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface CompletedWord {
  en: string;
  pt: string;
  phonetic_br: string;
  ipa: string;
  example_en: string;
  example_pt: string;
  emoji: string;
  category: string;
}

/** Escolhe o melhor modelo disponível na conta (Groq descontinua IDs com frequência). */
async function pickModel(): Promise<string> {
  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { authorization: `Bearer ${GROQ_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return MODEL_PREFERENCE[0];
    const data = await res.json();
    const ids = new Set(
      ((data?.data ?? []) as { id?: string; active?: boolean }[])
        .filter((m) => m?.active !== false && typeof m?.id === 'string')
        .map((m) => m.id as string),
    );
    return MODEL_PREFERENCE.find((m) => ids.has(m)) ?? MODEL_PREFERENCE[0];
  } catch {
    return MODEL_PREFERENCE[0];
  }
}

/** dictionaryapi.dev (grátis): corrige o IPA quando a palavra existe lá. */
async function refineIpa(word: string, ipa: string): Promise<string> {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return ipa;
    const data = await res.json();
    const ph = data?.[0]?.phonetic ?? data?.[0]?.phonetics?.find((p: { text?: string }) => p?.text)?.text;
    return typeof ph === 'string' && ph.length > 0 ? ph : ipa;
  } catch {
    return ipa;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!GROQ_KEY) return json({ error: 'GROQ_API_KEY not configured' }, 503);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  let text = '';
  try {
    const body = await req.json();
    text = String(body?.text ?? '').trim().slice(0, 60);
  } catch { /* corpo vazio/inválido */ }
  if (!text) return json({ error: 'empty text' }, 400);

  const system = [
    'Você completa dados de flashcards de inglês para brasileiros (app Gringolês).',
    'A entrada pode estar em INGLÊS ou PORTUGUÊS (palavra ou expressão curta). Detecte o idioma.',
    'Responda SEMPRE e APENAS com JSON no formato {"word":{"en":"","pt":"","phonetic_br":"","ipa":"","example_en":"","example_pt":"","emoji":"","category":""}}.',
    'Se a entrada for em português, traduza para o inglês natural mais comum e complete o resto.',
    'Se for em inglês, traduza para o português e complete o resto.',
    'phonetic_br = como soa em português, bem simples (ex.: "Water" → "uóra", "Doctor" → "dóctor").',
    'ipa = transcrição IPA completa entre barras (ex.: "/ˈdɒktər/").',
    'example_en = frase curta e do dia a dia usando a palavra em inglês; example_pt = tradução exata dessa frase.',
    'emoji = 1 emoji que represente a palavra. category = tema curto com inicial maiúscula (ex.: Comida, Viagem, Verbos, Phrasal Verbs).',
  ].join(' ');

  let w: CompletedWord;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await pickModel(),
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ error: 'groq failed', status: res.status, detail: detail.slice(0, 200) }, 502);
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    w = parsed.word ?? {};
  } catch {
    return json({ error: 'groq request failed' }, 502);
  }

  if (typeof w?.en !== 'string' || !w.en.trim() || typeof w?.pt !== 'string' || !w.pt.trim()) {
    return json({ error: 'empty result' }, 502);
  }

  const fields: CompletedWord = {
    en: w.en.trim(),
    pt: w.pt.trim(),
    phonetic_br: (w.phonetic_br ?? '').trim(),
    ipa: (w.ipa ?? '').trim(),
    example_en: (w.example_en ?? '').trim(),
    example_pt: (w.example_pt ?? '').trim(),
    emoji: (w.emoji ?? '📚').trim() || '📚',
    category: (w.category ?? 'Minhas').trim() || 'Minhas',
  };
  fields.ipa = await refineIpa(fields.en, fields.ipa);

  return json({ fields });
});
