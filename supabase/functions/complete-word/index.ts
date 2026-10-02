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
  example_past_en: string;
  example_past_pt: string;
  example_future_en: string;
  example_future_pt: string;
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
  let tensesFor: { en: string; pt: string } | null = null;
  try {
    const body = await req.json();
    text = String(body?.text ?? '').trim().slice(0, 60);
    const tf = body?.tensesFor;
    if (tf && typeof tf?.en === 'string' && tf.en.trim()) {
      tensesFor = { en: tf.en.trim().slice(0, 200), pt: String(tf?.pt ?? '').trim().slice(0, 200) };
    }
  } catch { /* corpo vazio/inválido */ }

  // Modo 2 (cards existentes): só conjuga a frase nos tempos passado/futuro.
  if (tensesFor) {
    const tenseSystem = [
      'Você é um professor de inglês para brasileiros.',
      'Receba uma frase de exemplo em inglês (com a tradução em português) e reescreva-a no PASSADO simples e no FUTURO simples (com "will"), mantendo o mesmo vocabulário e sentido.',
      'Responda SEMPRE e APENAS com JSON no formato {"tenses":{"past_en":"","past_pt":"","future_en":"","future_pt":""}}.',
      'past_en/future_en = a frase em inglês no passado/futuro; past_pt/future_pt = a tradução exata para o português.',
    ].join(' ');
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: await pickModel(),
          temperature: 0.2,
          max_tokens: 400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: tenseSystem },
            { role: 'user', content: JSON.stringify({ en: tensesFor.en, pt: tensesFor.pt }) },
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
      const tt = parsed.tenses ?? {};
      if (typeof tt?.past_en !== 'string' || !tt.past_en.trim() || typeof tt?.future_en !== 'string' || !tt.future_en.trim()) {
        return json({ error: 'empty result' }, 502);
      }
      return json({
        tenses: {
          past_en: tt.past_en.trim(),
          past_pt: (tt.past_pt ?? '').trim(),
          future_en: tt.future_en.trim(),
          future_pt: (tt.future_pt ?? '').trim(),
        },
      });
    } catch {
      return json({ error: 'groq request failed' }, 502);
    }
  }

  if (!text) return json({ error: 'empty text' }, 400);

  const system = [
    'Você completa dados de flashcards de inglês para brasileiros (app Gringolês).',
    'A entrada pode estar em INGLÊS ou PORTUGUÊS (palavra ou expressão curta). Detecte o idioma.',
    'Responda SEMPRE e APENAS com JSON no formato {"word":{"en":"","pt":"","phonetic_br":"","ipa":"","example_en":"","example_pt":"","example_past_en":"","example_past_pt":"","example_future_en":"","example_future_pt":"","emoji":"","category":""}}.',
    'Se a entrada for em português, traduza para o inglês natural mais comum e complete o resto.',
    'Se for em inglês, traduza para o português e complete o resto.',
    'phonetic_br = como soa em português, bem simples (ex.: "Water" → "uóra", "Doctor" → "dóctor").',
    'ipa = transcrição IPA completa entre barras (ex.: "/ˈdɒktər/").',
    'example_en = frase curta e do dia a dia usando a palavra em inglês (PRESENTE simples); example_pt = tradução exata dessa frase.',
    'example_past_en/example_future_en = A MESMA frase no passado simples / futuro simples com "will"; example_past_pt/example_future_pt = traduções exatas.',
    'emoji = 1 emoji que represente a palavra.',
    'category = classifique em EXATAMENTE um destes nomes: Essenciais, Casa, Comida, Viagem, Verbos, Rotina, Pessoas, Tech, Adjetivos, Natureza, Corpo, Roupas, Phrasal Verbs, Conjunções, Preposições, Advérbios, Cores, Números, Animais, Profissões, Emoções, Saúde, Escola, Trabalho, Esportes.',
    'Regras de classificação: conectivos (and, but, because, so, although) → Conjunções; localização/tempo (in, on, at, under, behind) → Preposições; modo/frequência (always, never, really, quickly) → Advérbios; cores → Cores; números/ordinais → Números; bichos (dog, cat, bird) → Animais; cargos (teacher, driver, engineer) → Profissões; sentimentos (sad, angry, excited) → Emoções; corpo/doença/remédio → Saúde; material escolar/aula → Escola; escritório/salário/reunião → Trabalho; esporte/jogo/time → Esportes; verbo frasal com partícula (give up, look after) → Phrasal Verbs.',
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

  const stripCat = (s: string) =>
    s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normCat = (s: string): string => {
    const key = stripCat(s);
    const aliases: Record<string, string> = {
      'conjuncoes': 'Conjunções', 'conjunctions': 'Conjunções', 'conjunction': 'Conjunções',
      'preposicoes': 'Preposições', 'prepositions': 'Preposições', 'preposition': 'Preposições',
      'adverbios': 'Advérbios', 'adverbs': 'Advérbios', 'adverb': 'Advérbios',
      'cores': 'Cores', 'colors': 'Cores', 'colours': 'Cores', 'color': 'Cores',
      'numeros': 'Números', 'numbers': 'Números',
      'animais': 'Animais', 'animals': 'Animais',
      'profissoes': 'Profissões', 'professions': 'Profissões', 'jobs': 'Profissões',
      'emocoes': 'Emoções', 'emotions': 'Emoções', 'feelings': 'Emoções',
      'saude': 'Saúde', 'health': 'Saúde',
      'escola': 'Escola', 'school': 'Escola', 'education': 'Escola',
      'trabalho': 'Trabalho', 'work': 'Trabalho', 'business': 'Trabalho', 'office': 'Trabalho',
      'esportes': 'Esportes', 'sports': 'Esportes', 'sport': 'Esportes',
    };
    return aliases[key] ?? (s.trim() ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : 'Minhas');
  };

  const fields: CompletedWord = {
    en: w.en.trim(),
    pt: w.pt.trim(),
    phonetic_br: (w.phonetic_br ?? '').trim(),
    ipa: (w.ipa ?? '').trim(),
    example_en: (w.example_en ?? '').trim(),
    example_pt: (w.example_pt ?? '').trim(),
    example_past_en: (w.example_past_en ?? '').trim(),
    example_past_pt: (w.example_past_pt ?? '').trim(),
    example_future_en: (w.example_future_en ?? '').trim(),
    example_future_pt: (w.example_future_pt ?? '').trim(),
    emoji: (w.emoji ?? '📚').trim() || '📚',
    category: normCat(w.category ?? 'Minhas'),
  };
  fields.ipa = await refineIpa(fields.en, fields.ipa);

  return json({ fields });
});
