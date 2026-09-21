/** Busca gratuita sem chave: https://dictionaryapi.dev — IPA + exemplo em inglês. */

export interface DictResult {
  ipa: string;
  exampleEN: string;
}

export async function lookupWord(word: string): Promise<DictResult | null> {
  const token = word.trim().toLowerCase().split(/\s+/)[0].replace(/[^a-z'-]/g, '');
  if (!token) return null;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(token)}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return null;
    const ipa: string =
      entry.phonetic ||
      entry.phonetics?.find((p: { text?: string }) => p.text)?.text ||
      entry.meanings?.[0]?.definitions?.[0]?.phonetic ||
      '';
    let exampleEN = '';
    for (const m of entry.meanings ?? []) {
      for (const d of m.definitions ?? []) {
        if (d.example) {
          exampleEN = d.example;
          break;
        }
      }
      if (exampleEN) break;
    }
    if (!ipa && !exampleEN) return null;
    return { ipa, exampleEN };
  } catch {
    return null; // offline ou erro — silencioso
  } finally {
    window.clearTimeout(timer);
  }
}
