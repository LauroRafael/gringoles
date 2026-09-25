/** Text-to-Speech via Web Speech API — grátis, sem chave, funciona offline (com vozes locais). */

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickVoice(langPrefix: string): SpeechSynthesisVoice | undefined {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return undefined;
    const pref = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
    // Prefere vozes Google / naturais
    const google = pref.find((v) => v.name.toLowerCase().includes('google'));
    if (google) return google;
    const natural = pref.find((v) => /natural|neural|samantha|zira|david|karen|moira|tessa/i.test(v.name));
    if (natural) return natural;
    return pref[0];
  } catch {
    return undefined;
  }
}

export interface SpeakOptions {
  lang?: 'en' | 'pt';
  rate?: number;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!speechSupported()) return;
  const { lang = 'en', rate = 0.95 } = opts;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'en' ? 'en-US' : 'pt-BR';
    u.rate = rate;
    const voice = pickVoice(lang === 'en' ? 'en' : 'pt');
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {
    // ignora — ambiente sem áudio
  }
}

export function speakEN(text: string, slow = false): void {
  speak(text, { lang: 'en', rate: slow ? 0.55 : 0.95 });
}

export function speakPT(text: string): void {
  speak(text, { lang: 'pt', rate: 1 });
}

/** Lê o exemplo em inglês e, ao terminar, em português — encadeado via onend. */
export function speakExamplePair(exampleEN: string, examplePT: string): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    const en = new SpeechSynthesisUtterance(exampleEN);
    en.lang = 'en-US';
    en.rate = 0.95;
    const enVoice = pickVoice('en');
    if (enVoice) en.voice = enVoice;
    let done = false;
    en.onend = () => {
      done = true;
      window.clearTimeout(fallback);
      try {
        const pt = new SpeechSynthesisUtterance(examplePT);
        pt.lang = 'pt-BR';
        pt.rate = 1;
        const ptVoice = pickVoice('pt');
        if (ptVoice) pt.voice = ptVoice;
        window.speechSynthesis.speak(pt);
      } catch {
        /* noop */
      }
    };
    // Fallback: se onend não disparar (voz ausente), agenda o PT por tempo estimado
    const fallbackMs = Math.max(1500, exampleEN.length * 90);
    const fallback = window.setTimeout(() => {
      if (done) return;
      done = true;
      try {
        speakPT(examplePT);
      } catch { /* noop */ }
    }, fallbackMs + 400);
    en.onerror = () => {
      if (done) return;
      done = true;
      window.clearTimeout(fallback);
      try {
        speakPT(examplePT);
      } catch { /* noop */ }
    };
    window.speechSynthesis.speak(en);
  } catch {
    /* noop */
  }
}

export function stopSpeak(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
}

/** Aliases compat (voz rápida via Web Speech — sem Piper/proxy). */
export const playEN = speakEN;
export const playPT = speakPT;
export const playExamplePair = speakExamplePair;
export const stopAudio = stopSpeak;
