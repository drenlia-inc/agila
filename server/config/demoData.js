import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { wrapQuery } from '../utils/queryLogger.js';
import { seedBilingualDemoBoards, DEMO_ADMIN_BIO } from './demoDataSeed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = dirname(__dirname);

const DEMO_AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Directory of optional local demo photos (not committed).
 * Override with DEMO_AVATAR_DIR.
 */
function getDemoAvatarSeedDir() {
  const fromEnv = String(process.env.DEMO_AVATAR_DIR || '').trim();
  if (fromEnv) return fromEnv;
  return join(SERVER_ROOT, 'demo-assets', 'avatars');
}

function getAvatarsOutputDir(tenantId = null) {
  if (tenantId && process.env.MULTI_TENANT === 'true') {
    const basePath =
      process.env.DOCKER_ENV === 'true' ? '/app/server' : join(SERVER_ROOT, '..');
    return join(basePath, 'avatars', 'tenants', tenantId);
  }
  return join(SERVER_ROOT, 'avatars');
}

/**
 * If a seed image exists for `slug` (e.g. john.jpg), copy into runtime avatars dir.
 * @returns {string|null} Public path `/avatars/...` or null if no seed file
 */
export function installDemoSeedAvatar(slug, userId, tenantId = null) {
  const safeSlug = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!safeSlug) return null;

  const seedDir = getDemoAvatarSeedDir();
  let sourcePath = null;
  let ext = null;
  for (const candidateExt of DEMO_AVATAR_EXTENSIONS) {
    const candidate = join(seedDir, `${safeSlug}${candidateExt}`);
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      ext = candidateExt;
      break;
    }
  }
  if (!sourcePath) return null;

  try {
    const avatarsDir = getAvatarsOutputDir(tenantId);
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    const filename = `demo-${safeSlug}-${userId}${ext}`;
    const destPath = join(avatarsDir, filename);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✅ Installed demo photo avatar: ${safeSlug}${ext} → ${filename}`);
    return `/avatars/${filename}`;
  } catch (error) {
    console.error(`Failed to install demo seed avatar for ${safeSlug}:`, error.message);
    return null;
  }
}

/**
 * Prefer optional seed photo; fall back to generated letter SVG.
 */
function resolveDemoUserAvatar(slug, letter, userId, color) {
  const fromSeed = installDemoSeedAvatar(slug, userId);
  if (fromSeed) return fromSeed;
  return createLetterAvatar(letter, userId, color);
}

/**
 * Utility function to create letter avatars
 */
function createLetterAvatar(letter, userId, color) {
  try {
    const size = 100;
    
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${color}"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.6}" 
            fill="white" text-anchor="middle" dominant-baseline="central" font-weight="bold">${letter}</text>
    </svg>`;
    
    const filename = `demo-${letter.toLowerCase()}-${Date.now()}.svg`;
    const avatarsDir = join(SERVER_ROOT, 'avatars');
    
    // Ensure avatars directory exists
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    
    const filePath = join(avatarsDir, filename);
    fs.writeFileSync(filePath, svg);
    
    console.log(`✅ Created demo letter avatar: ${filename}`);
    return `/avatars/${filename}`;
  } catch (error) {
    console.error('Error creating demo avatar:', error);
    return null;
  }
}

/**
 * Utility function to generate random passwords
 */
function generateRandomPassword(length = 12) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

/**
 * Create demo users (only called when DEMO_ENABLED=true)
 * @param {Object} db - Database instance
 * @returns {Array} Array of demo user objects with credentials
 */
export async function createDemoUsers(db) {
  if (process.env.DEMO_ENABLED !== 'true') {
    return [];
  }

  console.log('👥 Creating demo users...');

  const demoUsers = [
    {
      firstName: 'John',
      lastName: 'Smith',
      email: 'john.smith@demo.local',
      color: '#3B82F6', // Blue - distinctive and professional
      letter: 'J',
      avatarSlug: 'john',
      bio: 'Frontend lead · React & design systems. Coffee-powered. Ask me about accessibility or CSS that actually works.',
    },
    {
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@demo.local',
      color: '#10B981', // Green - fresh and vibrant
      letter: 'S',
      avatarSlug: 'sarah',
      bio: 'Product & UX. I turn fuzzy ideas into clear tickets. Usually in standups with a notebook and too many stickies.',
    },
    {
      firstName: 'Mike',
      lastName: 'Davis',
      email: 'mike.davis@demo.local',
      color: '#F59E0B', // Amber/Orange - warm and energetic
      letter: 'M',
      avatarSlug: 'mike',
      bio: 'Backend & APIs. PostgreSQL enthusiast. If it involves queues, auth, or “why is this slow?”, ping me.',
    },
  ];

  const userRoleResult = await wrapQuery(db.prepare('SELECT id FROM roles WHERE name = $1'), 'SELECT').get('user');
  const userRoleId = userRoleResult.id;
  const createdUsers = [];

  for (const user of demoUsers) {
    const userId = crypto.randomUUID();
    const password = generateRandomPassword(12);
    const passwordHash = bcrypt.hashSync(password, 10);
    const avatarPath = resolveDemoUserAvatar(
      user.avatarSlug,
      user.letter,
      userId,
      user.color
    );

    // Create user
    await wrapQuery(db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, avatar_path, bio) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `), 'INSERT').run(
      userId,
      user.email,
      passwordHash,
      user.firstName,
      user.lastName,
      avatarPath,
      user.bio
    );

    // Assign user role
    await wrapQuery(db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)'), 'INSERT').run(userId, userRoleId);

    // Store password in settings for easy retrieval
    await wrapQuery(db.prepare('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'), 'INSERT').run(
      `DEMO_PASSWORD_${user.email}`,
      password
    );

    createdUsers.push({
      id: userId,
      email: user.email,
      password,
      firstName: user.firstName,
      lastName: user.lastName,
      color: user.color
    });

    console.log(`✅ Created demo user: ${user.firstName} ${user.lastName} (${user.email})`);
  }

  return createdUsers;
}

/**
 * Shared users/members once, then English + French demo boards.
 */
export async function initializeDemoData(db) {
  if (process.env.DEMO_ENABLED !== 'true') {
    console.log('⏭️  Demo data initialization skipped (DEMO_ENABLED is not true)');
    return;
  }

  console.log('🎭 Initializing bilingual demo data...');

  await wrapQuery(
    db.prepare('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'),
    'INSERT'
  ).run('STORAGE_USED', '0');

  const demoUsers = await createDemoUsers(db);
  if (demoUsers.length === 0) {
    console.log('⚠️  No demo users created, skipping demo data');
    return;
  }

  const members = [];
  for (const user of demoUsers) {
    const memberId = crypto.randomUUID();
    // Board/team display name is first name only (full name stays on the user profile)
    const displayName = user.firstName;
    await wrapQuery(
      db.prepare('INSERT INTO members (id, name, color, user_id) VALUES ($1, $2, $3, $4)'),
      'INSERT'
    ).run(memberId, displayName, user.color, user.id);
    members.push({ id: memberId, name: displayName, userId: user.id });
  }

  const adminMember = await wrapQuery(
    db.prepare(`
      SELECT m.id, m.name, m.user_id AS "userId", u.first_name AS "firstName"
      FROM members m
      JOIN users u ON u.id = m.user_id
      WHERE u.email = 'admin@kanban.local'
      LIMIT 1
    `),
    'SELECT'
  ).get();
  if (adminMember?.id) {
    const adminDisplayName = adminMember.firstName || 'Alex';
    if (adminMember.name !== adminDisplayName) {
      await wrapQuery(
        db.prepare('UPDATE members SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'),
        'UPDATE'
      ).run(adminDisplayName, adminMember.id);
    }
    members.push({
      id: adminMember.id,
      name: adminDisplayName,
      userId: adminMember.userId,
    });
    await wrapQuery(
      db.prepare(`
        UPDATE users
        SET bio = $1, updated_at = CURRENT_TIMESTAMP
        WHERE email = 'admin@kanban.local'
          AND (bio IS NULL OR TRIM(bio) = '')
      `),
      'UPDATE'
    ).run(`${DEMO_ADMIN_BIO.en}\n${DEMO_ADMIN_BIO.fr}`);
  }

  await seedBilingualDemoBoards(db, members);
  console.log('🎉 Bilingual demo data initialization complete');
}

/**
 * Demo volumes persist across deploys. Keep board display names as first name only
 * for the stock demo personas (Alex, John, Sarah, Mike).
 */
export async function ensureDemoMemberDisplayFirstNames(db) {
  if (process.env.DEMO_ENABLED !== 'true') return;

  const result = await wrapQuery(
    db.prepare(`
      UPDATE members m
      SET name = u.first_name,
          updated_at = CURRENT_TIMESTAMP
      FROM users u
      WHERE m.user_id = u.id
        AND u.first_name IS NOT NULL
        AND TRIM(u.first_name) <> ''
        AND m.name IS DISTINCT FROM u.first_name
        AND (
          u.email = 'admin@kanban.local'
          OR u.email LIKE '%@demo.local'
        )
        AND u.email <> 'system@local'
    `),
    'UPDATE'
  ).run();

  const updated = Number(result?.rowCount ?? result?.changes ?? 0);
  if (updated > 0) {
    console.log(`✅ Demo members: set ${updated} display name(s) to first name only`);
  }
}


