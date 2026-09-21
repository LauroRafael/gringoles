/**
 * Migração única do nome antigo ("anki-flow-*") para o novo ("gringoles-*").
 * Roda antes da criação do store (importado primeiro em main.tsx),
 * então o zustand/persist já encontra os dados no lugar novo.
 */
const OLD_STORE_KEY = 'anki-flow-v1';
const NEW_STORE_KEY = 'gringoles-v1';
const OLD_THEME_KEY = 'anki-flow-theme';
const NEW_THEME_KEY = 'gringoles-theme';

try {
  if (!localStorage.getItem(NEW_STORE_KEY) && localStorage.getItem(OLD_STORE_KEY)) {
    localStorage.setItem(NEW_STORE_KEY, localStorage.getItem(OLD_STORE_KEY) as string);
  }
  if (!localStorage.getItem(NEW_THEME_KEY) && localStorage.getItem(OLD_THEME_KEY)) {
    localStorage.setItem(NEW_THEME_KEY, localStorage.getItem(OLD_THEME_KEY) as string);
  }
} catch {
  /* armazenamento indisponível — segue sem migrar */
}

export const STORE_KEY = NEW_STORE_KEY;
export const THEME_KEY = NEW_THEME_KEY;
