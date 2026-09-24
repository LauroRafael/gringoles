/** Validação local de senha (mitigação gratuita — Leaked Password Protection é Pro+).
 * Retorna null se ok, ou a chave i18n do problema. Regra: mín. 8 chars + letra + número.
 */
export function passwordIssue(pw: string): 'short' | 'weak' | null {
  if (pw.length < 8) return 'short';
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(pw) || !/\d/.test(pw)) return 'weak';
  return null;
}
