/**
 * Shared helpers for task/comment notification emails.
 */

/**
 * Pick a language string from bilingual activity JSON ({en, fr, ...}).
 * @param {string|object|null} details
 * @param {'en'|'fr'} [lang='en']
 */
export function formatDetailsForEmail(details, lang = 'en') {
  if (details == null) return '';

  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const preferred = lang === 'fr' ? obj.fr || obj.en : obj.en || obj.fr;
    return preferred || null;
  };

  if (typeof details === 'object') {
    const fromObj = pick(details);
    if (fromObj != null) return fromObj;
  }

  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      const fromParsed = pick(parsed);
      if (fromParsed != null) return fromParsed;
    } catch {
      /* plain string */
    }
  }

  return String(details);
}

/** Strip HTML to readable plain text for email diffs / details. */
export function stripHtmlForEmail(value) {
  if (value == null) return '';
  let s = String(value);
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/\s*p\s*>/gi, '\n');
  s = s.replace(/<\/\s*div\s*>/gi, '\n');
  s = s.replace(/<\/\s*li\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Build a deep-link that matches frontend generateTaskUrl().
 * Prefer /project/#PROJ#TASK so email clients' %23 encoding still parses.
 */
export function buildTaskEmailUrl(baseUrl, { projectId, ticket, taskId } = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const id = ticket || taskId;
  if (!id) return root || '/';
  if (projectId) {
    return `${root}/project/#${projectId}#${id}`;
  }
  // Path-based fallback (avoids bare #task#… which many clients break)
  return `${root}/task/#${id}`;
}

/** Split into words and whitespace so spacing is preserved in the diff. */
function tokenizeForDiff(text) {
  return String(text).match(/\S+|\s+/g) || [];
}

/**
 * Word-level LCS diff ops: { type: 'equal'|'remove'|'add', text }[]
 * Falls back to whole-string remove+add when inputs are huge (perf guard).
 */
export function diffWords(before, after) {
  const aText = before == null ? '' : String(before);
  const bText = after == null ? '' : String(after);
  if (aText === bText) return aText ? [{ type: 'equal', text: aText }] : [];

  const a = tokenizeForDiff(aText);
  const b = tokenizeForDiff(bText);

  // O(n*m) guard — long descriptions fall back to block replace
  if (a.length * b.length > 250_000 || a.length > 2_000 || b.length > 2_000) {
    const ops = [];
    if (aText) ops.push({ type: 'remove', text: aText });
    if (bText) ops.push({ type: 'add', text: bText });
    return ops;
  }

  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  const push = (type, text) => {
    if (!text) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      ops.push({ type, text });
    }
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i]);
      i += 1;
    } else {
      push('add', b[j]);
      j += 1;
    }
  }
  while (i < n) {
    push('remove', a[i]);
    i += 1;
  }
  while (j < m) {
    push('add', b[j]);
    j += 1;
  }

  return ops;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDiffSegmentHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/**
 * Email-safe inline HTML diff (removed = red strike, added = green highlight).
 */
export function formatWordDiffHtml(before, after) {
  const ops = diffWords(before, after);
  if (ops.length === 0) return '';

  return ops
    .map((op) => {
      const body = formatDiffSegmentHtml(op.text);
      if (op.type === 'remove') {
        return `<span style="background-color:#fecaca;color:#7f1d1d;text-decoration:line-through;">${body}</span>`;
      }
      if (op.type === 'add') {
        return `<span style="background-color:#bbf7d0;color:#14532d;font-weight:600;">${body}</span>`;
      }
      return `<span style="color:#374151;">${body}</span>`;
    })
    .join('');
}

/** Plain-text diff with [-removed] / [+added] markers. */
export function formatWordDiffText(before, after) {
  const ops = diffWords(before, after);
  if (ops.length === 0) return '';

  return ops
    .map((op) => {
      const t = op.text.replace(/\n/g, ' ');
      if (op.type === 'remove') return `[-${t}-]`;
      if (op.type === 'add') return `[+${t}+]`;
      return t;
    })
    .join('');
}

/**
 * Build comment-author avatar markup for HTML email.
 * Prefer public Google photo URLs; otherwise CID-embed local avatars (auth URLs
 * do not work in email clients). Fall back to a colored initials circle.
 *
 * @param {object} opts
 * @param {object} opts.db
 * @param {{ avatars?: string, attachments?: string }} opts.storagePaths
 * @param {object|null} opts.author - user/member row with avatar fields
 * @param {string} [opts.cid='comment-author-avatar']
 * @returns {Promise<{ html: string, attachments: object[] }>}
 */
export async function buildEmailAuthorAvatar({
  db,
  storagePaths,
  author,
  cid = 'comment-author-avatar',
} = {}) {
  const first =
    author?.first_name || author?.firstName || author?.name?.split?.(' ')?.[0] || 'U';
  const last =
    author?.last_name ||
    author?.lastName ||
    author?.name?.split?.(' ')?.slice(1).join(' ') ||
    '';
  const displayName =
    `${first} ${last}`.trim() || author?.name || 'User';
  const initials = `${String(first).charAt(0)}${String(last).charAt(0)}`
    .toUpperCase()
    .replace(/\s/g, '') ||
    String(displayName).charAt(0).toUpperCase() ||
    '?';
  const bgColor = author?.color || author?.memberColor || '#0ea5e9';

  const initialsHtml = `<div style="background-color:${escapeHtml(bgColor)};color:white;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-right:10px;font-weight:bold;font-size:12px;line-height:32px;text-align:center;vertical-align:middle;">${escapeHtml(initials)}</div>`;

  const googleUrl =
    author?.google_avatar_url || author?.googleAvatarUrl || null;
  const avatarPath = author?.avatar_path || author?.avatarPath || author?.avatarUrl || null;

  const imgStyle =
    'width:32px;height:32px;border-radius:50%;object-fit:cover;margin-right:10px;vertical-align:middle;display:inline-block;';

  if (googleUrl && /^https?:\/\//i.test(String(googleUrl))) {
    return {
      html: `<img src="${escapeHtml(String(googleUrl))}" alt="${escapeHtml(displayName)}" width="32" height="32" style="${imgStyle}" />`,
      attachments: [],
    };
  }

  if (avatarPath && db && storagePaths) {
    try {
      const { getObject, filenameFromPublicUrl } = await import(
        '../services/storage/index.js'
      );
      const filename = filenameFromPublicUrl(avatarPath, 'avatars');
      if (filename) {
        // SVG avatars (default generated) are blocked by most email clients — use initials
        if (/\.svg$/i.test(filename)) {
          return { html: initialsHtml, attachments: [] };
        }
        const obj = await getObject(db, storagePaths, 'avatars', filename);
        if (obj?.buffer) {
          return {
            html: `<img src="cid:${cid}" alt="${escapeHtml(displayName)}" width="32" height="32" style="${imgStyle}" />`,
            attachments: [
              {
                filename: filename,
                content: obj.buffer,
                contentType: obj.contentType || 'image/png',
                cid,
                contentDisposition: 'inline',
              },
            ],
          };
        }
      }
    } catch (err) {
      console.warn('Failed to embed author avatar in email:', err.message);
    }
  }

  return { html: initialsHtml, attachments: [] };
}

/**
 * Build an <img> for the site logo in transactional emails (public URLs only — no CID).
 * Custom uploads → `${baseUrl}/api/settings/site-logo`.
 * Built-in / empty SITE_LOGO with embedDefaultBrandLogo → `${baseUrl}/agila-logo.png`.
 *
 * @returns {{ html: string, attachments: object[] }}
 */
export function buildEmailSiteLogo({
  baseUrl,
  logoPath,
  hideSiteLogo = false,
  alt = 'Logo',
  embedDefaultBrandLogo = false,
} = {}) {
  if (hideSiteLogo) {
    return { html: '', attachments: [] };
  }

  const raw = String(logoPath || '').trim();
  const origin = String(baseUrl || '').replace(/\/$/, '');
  const imgStyle =
    'max-height:48px;max-width:200px;width:auto;height:auto;display:block;margin:0 auto;border:0;outline:none;text-decoration:none;';

  const isBuiltinPath =
    !raw ||
    raw.startsWith('/agila') ||
    raw.startsWith('/kanban') ||
    raw.startsWith('/assets/');

  let src = '';

  if (raw && !isBuiltinPath) {
    if (/^https?:\/\//i.test(raw)) {
      src = raw;
    } else if (origin) {
      const cacheKey = raw.includes('/avatars/')
        ? raw.split('/avatars/').pop()?.split('?')[0] || ''
        : '';
      src = `${origin}/api/settings/site-logo${cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : ''}`;
    }
  } else if (embedDefaultBrandLogo && origin) {
    // Shipping brand asset from public/ (also copied to dist/ in production)
    const builtin =
      raw.startsWith('/agila') || raw.startsWith('/kanban') || raw.startsWith('/assets/')
        ? raw
        : '/agila-logo.png';
    src = `${origin}${builtin}`;
  }

  if (!src) {
    return { html: '', attachments: [] };
  }

  return {
    html: `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="${imgStyle}" />`,
    attachments: [],
  };
}
