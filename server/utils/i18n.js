/**
 * Backend Internationalization (i18n) Utility
 *
 * Emails / correspondence: user language pref → APP_LANGUAGE → en
 * (see resolveCorrespondenceLanguage / getTranslatorForUser).
 * Most API error messages still use APP_LANGUAGE via getTranslator(db).
 * Falls back to English if translation not found or language not supported.
 */

import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cache for loaded translations
let translationsCache = {
  en: null,
  fr: null
};

/**
 * Load translation file for a given language
 * @param {string} lang - Language code ('en' or 'fr')
 * @returns {Object} Translation object
 */
function loadTranslations(lang) {
  // Normalize language code
  const normalizedLang = lang?.toUpperCase() === 'FR' ? 'fr' : 'en';
  
  // Return cached if available
  if (translationsCache[normalizedLang]) {
    return translationsCache[normalizedLang];
  }
  
  try {
    const filePath = join(__dirname, '../i18n/locales', `${normalizedLang}.json`);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const translations = JSON.parse(fileContent);
    
    // Cache the translations
    translationsCache[normalizedLang] = translations;
    
    return translations;
  } catch (error) {
    console.error(`Failed to load translations for language '${normalizedLang}':`, error);
    // Fallback to English
    if (normalizedLang !== 'en') {
      return loadTranslations('en');
    }
    return {};
  }
}

/**
 * Get APP_LANGUAGE setting from database
 * @param {Object} db - Database instance
 * @returns {Promise<string>} Language code ('en' or 'fr')
 */
export async function getAppLanguage(db) {
  try {
    const { wrapQuery } = await import('./queryLogger.js');
    const setting = await wrapQuery(db.prepare('SELECT value FROM settings WHERE key = ?'), 'SELECT').get('APP_LANGUAGE');
    const lang = setting?.value || 'EN';
    return lang.toUpperCase() === 'FR' ? 'fr' : 'en';
  } catch (error) {
    console.error('Failed to get APP_LANGUAGE from settings:', error);
    return 'en'; // Default to English
  }
}

/**
 * Normalize a language value to 'en' | 'fr', or null if unset/unsupported.
 * @param {unknown} value
 * @returns {'en'|'fr'|null}
 */
export function normalizeLanguage(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v === 'fr' || v.startsWith('fr')) return 'fr';
  if (v === 'en' || v.startsWith('en')) return 'en';
  return null;
}

/**
 * Read the user's preferred UI/correspondence language from user_settings.
 * @param {Object} db
 * @param {string|null|undefined} userId
 * @returns {Promise<'en'|'fr'|null>}
 */
export async function getUserLanguage(db, userId) {
  if (!db || !userId) return null;
  try {
    const { wrapQuery } = await import('./queryLogger.js');
    const row = await wrapQuery(
      db.prepare(
        'SELECT setting_value FROM user_settings WHERE userid = ? AND setting_key = ?'
      ),
      'SELECT'
    ).get(userId, 'language');
    return normalizeLanguage(row?.setting_value);
  } catch (error) {
    console.warn('Failed to get user language preference:', error.message);
    return null;
  }
}

/**
 * Language for emails / server correspondence.
 * Order: user pref → APP_LANGUAGE → en
 * @param {Object} db
 * @param {string|null|undefined} [userId]
 * @returns {Promise<'en'|'fr'>}
 */
export async function resolveCorrespondenceLanguage(db, userId = null) {
  const userLang = await getUserLanguage(db, userId);
  if (userLang) return userLang;
  if (db) return getAppLanguage(db);
  return 'en';
}

/**
 * Translate a key using dot notation (e.g., 'errors.columnNotFound')
 * @param {string} key - Translation key in dot notation
 * @param {Object} params - Parameters to replace in the translation (e.g., {resource: 'tasks'})
 * @param {string} lang - Language code ('en' or 'fr'), defaults to 'en'
 * @returns {string} Translated string
 */
export function t(key, params = {}, lang = 'en') {
  const translations = loadTranslations(lang);
  
  // Navigate through nested object using dot notation
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Key not found, try English fallback if not already English
      if (lang !== 'en') {
        return t(key, params, 'en');
      }
      // Return the key itself if not found even in English
      console.warn(`Translation key not found: ${key}`);
      return key;
    }
  }
  
  // If value is a string, replace parameters
  if (typeof value === 'string') {
    let result = value;
    for (const [paramKey, paramValue] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue);
    }
    return result;
  }
  
  return value || key;
}

/**
 * Get translation function bound to a specific language from database
 * @param {Object} db - Database instance
 * @returns {Function} Translation function bound to the app language
 */
export async function getTranslator(db) {
  const lang = await getAppLanguage(db);
  return (key, params = {}) => t(key, params, lang);
}

/**
 * Get translation function for a specific language (not from database)
 * @param {string} lang - Language code ('en' or 'fr')
 * @returns {Function} Translation function bound to the specified language
 */
export function getTranslatorForLanguage(lang = 'en') {
  return (key, params = {}) => t(key, params, lang);
}

/**
 * Translator bound to a recipient's correspondence language.
 * @param {Object} db
 * @param {string|null|undefined} [userId]
 * @returns {Promise<(key: string, params?: object) => string>}
 */
export async function getTranslatorForUser(db, userId = null) {
  const lang = await resolveCorrespondenceLanguage(db, userId);
  return getTranslatorForLanguage(lang);
}

/**
 * Get bilingual translations (both English and French)
 * @param {string} key - Translation key
 * @param {Object} params - Parameters to replace in the translation
 * @returns {Object} Object with 'en' and 'fr' translations
 */
export function getBilingualTranslation(key, params = {}) {
  return {
    en: t(key, params, 'en'),
    fr: t(key, params, 'fr')
  };
}

/**
 * Clear translation cache (useful for testing or hot-reloading)
 */
export function clearTranslationCache() {
  translationsCache = {
    en: null,
    fr: null
  };
}

