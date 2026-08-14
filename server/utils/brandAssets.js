/**
 * Shipping Agila brand assets (public/ → dist/ in production builds).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the default Agila logo PNG, or null if missing.
 * @param {'light'|'dark'} [variant='light']
 * @returns {string|null}
 */
export function resolveDefaultBrandLogoPath(variant = 'light') {
  const filename =
    variant === 'dark' ? 'agila-logo-dark.png' : 'agila-logo.png';
  const candidates = [
    path.join(process.cwd(), 'public', filename),
    path.join(process.cwd(), 'dist', filename),
    path.join(here, '..', '..', 'public', filename),
    path.join(here, '..', '..', 'dist', filename),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}
