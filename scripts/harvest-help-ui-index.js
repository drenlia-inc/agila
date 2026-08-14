#!/usr/bin/env node
/**
 * Harvest Help Assistant UI index from src/ data-* attributes + locale JSON.
 * Usage:
 *   node scripts/harvest-help-ui-index.js         # write generated file
 *   node scripts/harvest-help-ui-index.js --check # fail if stale
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'server/config/helpUiIndex.generated.json');

const ATTRS = [
  { attr: 'data-setting-key', kind: 'setting' },
  { attr: 'data-tour-id', kind: 'tour' },
  { attr: 'data-help-target', kind: 'help' },
  { attr: 'data-owner-setup', kind: 'ownerSetup' }
];

const SKIP_VALUE = /\$\{|`/;

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) acc.push(full);
  }
  return acc;
}

function flatten(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function loadLocales() {
  const en = {};
  const fr = {};
  for (const ns of ['common', 'admin', 'tasks']) {
    const enPath = path.join(SRC, 'i18n/locales/en', `${ns}.json`);
    const frPath = path.join(SRC, 'i18n/locales/fr', `${ns}.json`);
    if (fs.existsSync(enPath)) Object.assign(en, flatten(JSON.parse(fs.readFileSync(enPath, 'utf8')), ns));
    if (fs.existsSync(frPath)) Object.assign(fr, flatten(JSON.parse(fs.readFileSync(frPath, 'utf8')), ns));
  }
  return { en, fr };
}

function parseAdminSearchIndex() {
  const ts = fs.readFileSync(path.join(SRC, 'constants/adminSearchIndex.ts'), 'utf8');
  const byKey = new Map();
  const blocks = ts.split(/\n\s*\{/).slice(1);
  for (const block of blocks) {
    const settingKey = block.match(/settingKey:\s*'([^']+)'/)?.[1];
    const hash = block.match(/hash:\s*'([^']+)'/)?.[1];
    const labelKey = block.match(/labelKey:\s*'([^']+)'/)?.[1];
    if (settingKey && hash) {
      byKey.set(settingKey, { hash, labelKey: labelKey ? `admin.${labelKey}` : null });
    }
  }
  return byKey;
}

function kebabToCamel(id) {
  return id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function nearbyTKeys(source, index) {
  const window = source.slice(Math.max(0, index - 800), index + 800);
  const keys = [];
  const re = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
  let m;
  while ((m = re.exec(window))) keys.push(m[1]);
  return [...new Set(keys)].slice(0, 8);
}

function lookupLocale(locales, key) {
  if (!key) return { en: '', fr: '' };
  const tryKeys = [
    key,
    `common.${key}`,
    `admin.${key}`,
    `tasks.${key}`
  ];
  let en = '';
  let fr = '';
  for (const k of tryKeys) {
    if (!en && locales.en[k]) en = locales.en[k];
    if (!fr && locales.fr[k]) fr = locales.fr[k];
  }
  return { en, fr };
}

const FILE_HASH = [
  [/AdminSiteSettingsTab/, '#admin#site-settings'],
  [/AdminSSOTab/, '#admin#system-settings#sso'],
  [/AdminMailTab/, '#admin#system-settings#mail-server'],
  [/AdminStorageTab/, '#admin#system-settings#storage'],
  [/AdminFileUploadsTab/, '#admin#system-settings#file-uploads'],
  [/AdminAISettingsTab/, '#admin#system-settings#ai'],
  [/AdminNotificationsSettingsTab/, '#admin#system-settings#notifications'],
  [/AdminNotificationQueueTab/, '#admin#system-settings#notification-queue'],
  [/AdminAppSettingsTab/, '#admin#app-settings#user-interface'],
  [/AdminTroubleshootingTab/, '#admin#app-settings#troubleshooting'],
  [/AdminProjectSettingsTab|AdminProjectHubTab/, '#admin#project-settings#project'],
  [/AdminFeaturesSettingsTab/, '#admin#project-settings#features'],
  [/AdminSprintSettingsTab/, '#admin#project-settings#sprint-settings'],
  [/AdminReportingTab/, '#admin#project-settings#reporting'],
  [/AdminLifecycleTab/, '#admin#project-settings#lifecycle'],
  [/AdminLicensingTab/, '#admin#licensing'],
  [/AdminUsersTab/, '#admin#users'],
  [/AdminTagsTab/, '#admin#tags'],
  [/AdminPrioritiesTab/, '#admin#priorities']
];

function hashFromFile(fileRel) {
  const hit = FILE_HASH.find(([re]) => re.test(fileRel));
  return hit ? hit[1] : '#admin';
}

function inferNav(kind, value, fileRel, adminByKey) {
  const rel = fileRel.replace(/\\/g, '/');
  const inAdmin = /\/admin\//i.test(rel) || /Admin/.test(rel);
  if (kind === 'setting') {
    const meta = adminByKey.get(value);
    return {
      navKind: 'admin',
      hash: meta?.hash || hashFromFile(fileRel),
      adminOnly: true,
      highlights: [`[data-setting-key="${value}"]`]
    };
  }
  if (kind === 'ownerSetup') {
    return {
      navKind: 'admin',
      hash: '#admin',
      adminOnly: true,
      highlights: [`[data-owner-setup="${value}"]`]
    };
  }
  if (kind === 'help') {
    if (value.startsWith('profile')) {
      return {
        navKind: 'profile',
        profileFocus: value.includes('activity') ? 'activityFeed' : 'displayName',
        adminOnly: false,
        highlights: [`[data-help-target="${value}"]`]
      };
    }
    return {
      navKind: 'view',
      mode: 'kanban',
      adminOnly: false,
      highlights: [`[data-help-target="${value}"]`]
    };
  }
  // tour
  const highlights = [`[data-tour-id="${value}"]`];
  if (value.startsWith('admin-') || inAdmin) {
    return { navKind: 'admin', hash: '#admin', adminOnly: true, highlights };
  }
  if (value.includes('report')) {
    return { navKind: 'page', page: 'reports', adminOnly: false, highlights };
  }
  if (value.includes('gantt')) {
    return { navKind: 'view', mode: 'gantt', adminOnly: false, highlights };
  }
  if (value.includes('list-view') || value === 'list-view') {
    return { navKind: 'view', mode: 'list', adminOnly: false, highlights };
  }
  if (value.includes('profile')) {
    return { navKind: 'view', mode: 'kanban', adminOnly: false, highlights };
  }
  return { navKind: 'view', mode: 'kanban', adminOnly: false, highlights };
}

function buildEntries() {
  const locales = loadLocales();
  const adminByKey = parseAdminSearchIndex();
  const files = walk(SRC);
  const seen = new Map();

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const fileRel = path.relative(ROOT, file);
    for (const { attr, kind } of ATTRS) {
      const re = new RegExp(`${attr}=(?:\\{)?["'\`]([^"'\`]+)["'\`](?:\\})?`, 'g');
      let m;
      while ((m = re.exec(source))) {
        if (kind === 'setting' || kind === 'ownerSetup') {
          if (/HelpModal\.tsx$/.test(fileRel)) continue;
        }
        const value = m[1].trim();
        if (!value || SKIP_VALUE.test(value)) continue;
        const id = `${kind}:${value}`;
        if (seen.has(id)) continue;
        const nav = inferNav(kind, value, fileRel, adminByKey);
        const nearby = nearbyTKeys(source, m.index);
        const fromNearby = nearby.map((k) => lookupLocale(locales, k));
        let en = '';
        let fr = '';
        if (kind === 'setting') {
          const meta = adminByKey.get(value);
          const lab = lookupLocale(locales, meta?.labelKey);
          en = lab.en;
          fr = lab.fr;
        }
        if (kind === 'tour') {
          const camel = kebabToCamel(value);
          const tourLab = lookupLocale(locales, `common.tour.steps.${camel}`);
          en = tourLab.en || en;
          fr = tourLab.fr || fr;
        }
        if (!en && fromNearby[0]) en = fromNearby[0].en;
        if (!fr && fromNearby[0]) fr = fromNearby[0].fr;
        if (value === 'profile-activity-feed') {
          const lab = lookupLocale(locales, 'common.profile.activityFeed');
          en = lab.en || en;
          fr = lab.fr || fr;
        }
        if (value === 'task-page-link') {
          const lab = lookupLocale(locales, 'tasks.taskCard.directLinkTo');
          en = lab.en ? lab.en.replace('{{ticket}}', '').trim() : 'Full task page (ticket ID)';
          fr = lab.fr ? lab.fr.replace('{{ticket}}', '').trim() : 'Page tâche (identifiant)';
        }
        if (!en) en = value.replace(/[-_]/g, ' ');
        if (!fr) fr = en;

        let extraEn = fromNearby.map((x) => x.en).filter(Boolean).join(' ');
        let extraFr = fromNearby.map((x) => x.fr).filter(Boolean).join(' ');

        if (value.includes('trash') || /trash/i.test(fileRel)) {
          extraEn += ' trash deleted';
          extraFr += ' corbeille supprimees supprimes';
        }
        if (/activity.?feed/i.test(value) || /ActivityFeed|profile-activity/.test(value + fileRel)) {
          extraEn += ' activity feed profile';
          extraFr += ' fil activite profil';
        }
        if (value === 'task-page-link') {
          extraEn += ' full page task page TaskPage ticket direct link';
          extraFr += ' page tache vue page ticket lien direct';
        }

        seen.set(id, {
          id,
          attr: kind,
          value,
          en: String(en).slice(0, 240),
          fr: String(fr).slice(0, 240),
          searchEn: `${en} ${extraEn} ${value}`.slice(0, 800),
          searchFr: `${fr} ${extraFr} ${value}`.slice(0, 800),
          kind: nav.navKind,
          hash: nav.hash || undefined,
          page: nav.page || undefined,
          mode: nav.mode || undefined,
          profileFocus: nav.profileFocus || undefined,
          highlights: nav.highlights,
          adminOnly: Boolean(nav.adminOnly),
          audience: nav.adminOnly ? 'admin' : 'user',
          file: fileRel
        });
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function canonical(entries) {
  return `${JSON.stringify({ generated: true, entries }, null, 2)}\n`;
}

const check = process.argv.includes('--check');
const entries = buildEntries();
const next = canonical(entries);

if (check) {
  if (!fs.existsSync(OUT)) {
    console.error('helpUiIndex.generated.json missing. Run: npm run help:ui-index');
    process.exit(1);
  }
  const prev = fs.readFileSync(OUT, 'utf8');
  if (prev !== next) {
    console.error(
      `helpUiIndex.generated.json is stale (${entries.length} harvested rows). Run: npm run help:ui-index`
    );
    process.exit(1);
  }
  console.log(`help UI index up to date (${entries.length} rows)`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, next);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${entries.length} rows)`);
