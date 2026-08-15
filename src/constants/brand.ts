/**
 * Public Agila brand / project links (operator-facing).
 * Keep in sync with `server/constants/brand.js`.
 */

export const AGILA_GITHUB_OWNER = 'drenlia-inc';
export const AGILA_GITHUB_REPO = 'agila';
export const AGILA_GITHUB_URL = `https://github.com/${AGILA_GITHUB_OWNER}/${AGILA_GITHUB_REPO}`;
export const AGILA_GITHUB_CLONE_URL = `${AGILA_GITHUB_URL}.git`;
export const AGILA_GITHUB_IDEAS_URL = `${AGILA_GITHUB_URL}/discussions/categories/ideas`;
export const AGILA_GITHUB_ISSUES_URL = `${AGILA_GITHUB_URL}/issues`;

/** GitHub.com has no locale in the URL; we localize the bug-report compose form. */
export function agilaGithubFeedbackUrls(lang?: string): { ideas: string; issues: string } {
  const fr = (lang || 'en').toLowerCase().startsWith('fr');
  const issueTitle = fr ? 'Rapport de bogue' : 'Bug report';
  const issueBody = fr
    ? '## Description\n\n## Étapes pour reproduire\n1.\n2.\n\n## Comportement attendu\n\n## Déploiement (Docker, démo, auto-hébergé)\n'
    : '## Description\n\n## Steps to reproduce\n1.\n2.\n\n## Expected behavior\n\n## Deploy (Docker, demo, self-hosted)\n';
  const issues = `${AGILA_GITHUB_URL}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}`;
  return { ideas: AGILA_GITHUB_IDEAS_URL, issues };
}
