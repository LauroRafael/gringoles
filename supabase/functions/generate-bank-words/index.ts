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

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface GenWord {
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

  let count = 20;
  try {
    const body = await req.json();
    count = Math.min(Math.max(Number(body?.count) || 20, 1), 30);
  } catch { /* corpo vazio/inválido → usa o padrão */ }

  const [{ data: bank, error: bankErr }, { data: cards, error: cardsErr }] = await Promise.all([
    admin.from('word_bank').select('en, category'),
    admin.from('cards').select('en').eq('user_id', user.id),
  ]);
  if (bankErr || cardsErr) return json({ error: 'db read failed' }, 500);

  const bankRows = (bank ?? []) as { en: string; category: string }[];
  const cardRows = (cards ?? []) as { en: string }[];
  const exclude = new Set<string>([
    ...bankRows.map((r) => norm(r.en)),
    ...cardRows.map((r) => norm(r.en)),
  ]);
  const categories = [...new Set(bankRows.map((r) => r.category).filter(Boolean))];
  const excludeSample = [...exclude].slice(0, 400);

  const system = [
    'Você gera flashcards de inglês para brasileiros (app Gringolês).',
    'Responda SEMPRE e APENAS com JSON no formato {"words":[{"en":"","pt":"","phonetic_br":"","ipa":"","example_en":"","example_pt":"","emoji":"","category":""}]}.',
    'phonetic_br = como soa em português, bem simples (ex.: "Water" → "uóra", "Doctor" → "dóctor").',
    'ipa = transcrição IPA completa entre barras (ex.: "/ˈdɒktər/").',
    'example_en = frase curta e do dia a dia em inglês; example_pt = tradução exata dessa frase.',
    'emoji = 1 emoji que represente a palavra. category = tema curto com inicial maiúscula.',
    'Palavras úteis e comuns (nível básico a intermediário), sem repetir NENHUMA palavra da lista de exclusão.',
  ].join(' ');
  const userMsg = [
    `Gere exatamente ${count} palavras novas.`,
    `Categorias já existentes (use a maioria, mas pode criar 1 ou 2 novas coerentes): ${categories.join(', ')}.`,
    `Palavras proibidas (já existentes): ${excludeSample.join(', ')}.`,
  ].join('\n');

  let words: GenWord[];
  let modelUsed = '';
  try {
    const model = await pickModel();
    modelUsed = model;
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ error: 'groq failed', status: res.status, detail: detail.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    words = Array.isArray(parsed.words) ? parsed.words : [];
  } catch {
    return json({ error: 'groq request failed' }, 502);
  }

  const seen = new Set<string>(exclude);
  const clean = words
    .filter((w) => {
      if (!w || typeof w.en !== 'string' || typeof w.pt !== 'string') return false;
      const key = norm(w.en);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((w) => ({
      en: w.en.trim(),
      pt: w.pt.trim(),
      phonetic_br: (w.phonetic_br ?? '').trim(),
      ipa: (w.ipa ?? '').trim(),
      example_en: (w.example_en ?? '').trim(),
      example_pt: (w.example_pt ?? '').trim(),
      emoji: (w.emoji ?? '📚').trim() || '📚',
      category: (w.category ?? 'Banco').trim() || 'Banco',
    }));

  if (clean.length === 0) return json({ words: [] });

  const refined = await Promise.all(clean.map(async (w) => ({ ...w, ipa: await refineIpa(w.en, w.ipa) })));
  const stamp = Date.now().toString(36);
  const rows = refined.map((w, i) => ({ bank_id: `auto-${stamp}-${i}`, ...w, active: true }));

  const { data: inserted, error: insertErr } = await admin.from('word_bank').insert(rows).select();
  if (insertErr) return json({ error: 'insert failed' }, 500);

  return json({ words: inserted ?? [], model: modelUsed });
});
