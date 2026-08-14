/**
 * Human-facing Agent replies follow the owner's preferred language (en|fr).
 */
export function replyLanguageInstruction(payload) {
  const raw = String(payload?.replyLanguage || 'en').toLowerCase();
  const lang = raw.startsWith('fr') ? 'fr' : 'en';
  const name = lang === 'fr' ? 'French' : 'English';
  return (
    `Write all human-facing text (finish summaries, dry-run plan summaries, comments) in ${name} ` +
    `(user preferred language: ${lang}). Keep board, column, and task titles exactly as stored. ` +
    `Tool names and JSON argument keys stay as specified.`
  );
}
