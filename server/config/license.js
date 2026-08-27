// License configuration and management
import { wrapQuery } from '../utils/queryLogger.js';
import { getStorageUsage as getStorageUsageFromUtils } from '../utils/storageUtils.js';
import { webhooks as webhookQueries } from '../utils/sqlManager/index.js';

/** Soft fair-use cap when STORAGE_LIMIT is unlimited (-1). Not shown on pricing cards. */
const PRO_STORAGE_SOFT_CAP_BYTES = 1024 * 1024 * 1024 * 1024; // 1 TiB

function isUnlimitedNumeric(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return n === -1;
}

class LicenseManager {
  constructor(db) {
    this.db = db;
    this.enabled = process.env.LICENSE_ENABLED === 'true';
    
    // Default limits from environment variables
    this.defaultLimits = {
      USER_LIMIT: parseInt(process.env.USER_LIMIT) || 5,
      TASK_LIMIT: parseInt(process.env.TASK_LIMIT) || -1,
      BOARD_LIMIT: parseInt(process.env.BOARD_LIMIT) || 10,
      STORAGE_LIMIT: parseInt(process.env.STORAGE_LIMIT) || 107374182400, // 100 GiB
      SUPPORT_LEVEL: process.env.SUPPORT_LEVEL || 'basic',
      AI_TIER: process.env.AI_TIER || 'off'
    };
  }

  /**
   * Effective bytes for enforcement. Unlimited (-1) → internal soft cap.
   * @param {object|null} limits
   * @returns {number|null} null = no enforcement
   */
  getEffectiveStorageLimitBytes(limits) {
    if (!limits || limits.STORAGE_LIMIT === undefined || limits.STORAGE_LIMIT === null) {
      return null;
    }
    if (isUnlimitedNumeric(limits.STORAGE_LIMIT)) {
      return PRO_STORAGE_SOFT_CAP_BYTES;
    }
    const n = typeof limits.STORAGE_LIMIT === 'number'
      ? limits.STORAGE_LIMIT
      : parseInt(limits.STORAGE_LIMIT, 10);
    return Number.isNaN(n) ? null : n;
  }

  // Get current license limits (from database if available, otherwise from environment)
  async getLimits() {
    if (!this.enabled) {
      return null; // No limits when licensing is disabled
    }

    const isMultiTenant = process.env.MULTI_TENANT === 'true';

    try {
      // Try to get limits from license_settings table first
      const licenseSettings = await wrapQuery(
        this.db.prepare('SELECT setting_key, setting_value FROM license_settings'),
        'SELECT'
      ).all();

      if (licenseSettings.length > 0) {
        // In multi-tenant mode, only use database values (no fallback to env vars)
        // In single-tenant mode, merge database values with env var defaults
        const limits = isMultiTenant ? {} : { ...this.defaultLimits };
        
        licenseSettings.forEach(setting => {
          let key = setting.setting_key;
          const value = setting.setting_value;
          // Legacy alias from older deploys
          if (key === 'SUPPORT_TYPE') key = 'SUPPORT_LEVEL';

          if (key === 'SUPPORT_LEVEL' || key === 'AI_TIER') {
            limits[key] = value;
          } else {
            const n = parseInt(value, 10);
            limits[key] = Number.isNaN(n) ? value : n;
          }
        });

        // Ensure SUPPORT_LEVEL is always present for Admin UI consumers
        if (!limits.SUPPORT_LEVEL) {
          limits.SUPPORT_LEVEL = this.defaultLimits.SUPPORT_LEVEL || 'basic';
        }
        
        return limits;
      }
    } catch (error) {
      console.warn('Failed to read license settings from database:', error.message);
    }

    // In multi-tenant mode, never fallback to environment variables
    // Each tenant must have their license settings in the database
    if (isMultiTenant) {
      return null;
    }

    // Fallback to environment variables (only in single-tenant mode)
    return this.defaultLimits;
  }

  // Check if licensing is enabled
  isEnabled() {
    return this.enabled;
  }

  // Get user count (excluding system user and AI agent pseudo-user)
  async getUserCount() {
    try {
      const systemUserId = '00000000-0000-0000-0000-000000000000';
      const agentUserId = '00000000-0000-0000-0000-000000000010';
      // Use true instead of 1 for PostgreSQL compatibility (SQLite also accepts true)
      const result = await wrapQuery(
        this.db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = true AND id != $1 AND id != $2'),
        'SELECT'
      ).get(systemUserId, agentUserId);
      return result.count;
    } catch (error) {
      console.error('Error getting user count:', error);
      return 0;
    }
  }

  // Get task count for a specific board
  async getTaskCount(boardId) {
    try {
      const result = await wrapQuery(
        this.db.prepare('SELECT COUNT(*) as count FROM tasks WHERE boardid = $1'),
        'SELECT'
      ).get(boardId);
      return result.count;
    } catch (error) {
      console.error('Error getting task count:', error);
      return 0;
    }
  }

  // Get total task count across all boards
  async getTotalTaskCount() {
    try {
      const result = await wrapQuery(
        this.db.prepare('SELECT COUNT(*) as count FROM tasks'),
        'SELECT'
      ).get();
      return result.count;
    } catch (error) {
      console.error('Error getting total task count:', error);
      return 0;
    }
  }

  // Get board count (live + soft-deleted — trash still occupies a license slot until purged)
  async getBoardCount() {
    try {
      const breakdown = await this.getBoardCountBreakdown();
      return breakdown.total;
    } catch (error) {
      console.error('Error getting board count:', error);
      return 0;
    }
  }

  async getBoardCountBreakdown() {
    try {
      const result = await wrapQuery(
        this.db.prepare(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
            COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS "softDeleted"
          FROM boards
        `),
        'SELECT'
      ).get();
      return {
        total: Number(result?.total) || 0,
        live: Number(result?.live) || 0,
        softDeleted: Number(result?.softDeleted ?? result?.softdeleted) || 0,
      };
    } catch (error) {
      console.error('Error getting board count breakdown:', error);
      return { total: 0, live: 0, softDeleted: 0 };
    }
  }

  // Get storage usage (uses STORAGE_USED setting which is maintained by storageUtils)
  async getStorageUsage() {
    try {
      // Use the storageUtils function which reads from STORAGE_USED setting
      // This is maintained by updateStorageUsage() whenever attachments are added/removed
      return getStorageUsageFromUtils(this.db);
    } catch (error) {
      console.error('Error getting storage usage:', error);
      return 0;
    }
  }

  // Check user limit
  async checkUserLimit() {
    if (!this.enabled) return true;

    const limits = await this.getLimits();
    if (!limits) return true;

    const userCount = await this.getUserCount();
    if (userCount >= limits.USER_LIMIT) {
      throw new Error(`User limit exceeded. Current: ${userCount}, Maximum: ${limits.USER_LIMIT}`);
    }
    return true;
  }

  // Check task limit for a board
  async checkTaskLimit(boardId) {
    if (!this.enabled) return true;

    const limits = await this.getLimits();
    if (!limits || limits.TASK_LIMIT === -1) return true; // -1 means unlimited

    const taskCount = await this.getTaskCount(boardId);
    if (taskCount >= limits.TASK_LIMIT) {
      throw new Error(`Task limit exceeded for this board. Current: ${taskCount}, Maximum: ${limits.TASK_LIMIT}`);
    }
    return true;
  }

  // Check board limit
  async checkBoardLimit() {
    if (!this.enabled) return true;

    const limits = await this.getLimits();
    if (!limits || limits.BOARD_LIMIT === -1) return true; // -1 means unlimited

    const breakdown = await this.getBoardCountBreakdown();
    if (breakdown.total >= limits.BOARD_LIMIT) {
      const error = new Error(
        `Board limit exceeded. Current: ${breakdown.total}, Maximum: ${limits.BOARD_LIMIT}`
      );
      error.code = 'BOARD_LIMIT';
      error.liveCount = breakdown.live;
      error.softDeletedCount = breakdown.softDeleted;
      error.boardLimit = limits.BOARD_LIMIT;
      throw error;
    }
    return true;
  }

  // Check storage limit (optional additionalBytes for pending upload)
  async checkStorageLimit(additionalBytes = 0) {
    if (!this.enabled) return true;

    const limits = await this.getLimits();
    if (!limits) return true;

    const maxBytes = this.getEffectiveStorageLimitBytes(limits);
    if (maxBytes === null) return true;

    const storageUsage = await this.getStorageUsage();
    const projected = storageUsage + (Number(additionalBytes) || 0);
    if (projected > maxBytes) {
      throw new Error(
        `Storage limit exceeded. Current: ${storageUsage} bytes, Maximum: ${maxBytes} bytes`
      );
    }
    return true;
  }

  // Update license settings in database
  async updateLicenseSetting(key, value) {
    if (!this.enabled) return;

    try {
      await wrapQuery(
        this.db.prepare('INSERT INTO license_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP'),
        'INSERT'
      ).run(key, value);
    } catch (error) {
      console.error('Error updating license setting:', error);
      throw error;
    }
  }

  // Get board task counts for detailed breakdown
  async getBoardTaskCounts() {
    try {
      const boards = await wrapQuery(
        this.db.prepare(`
          SELECT 
            b.id,
            b.title,
            COUNT(t.id) as "taskCount"
          FROM boards b
          LEFT JOIN tasks t ON b.id = t.boardid
          GROUP BY b.id, b.title
          ORDER BY "taskCount" DESC, b.title ASC
        `),
        'SELECT'
      ).all();
      
      return boards.map(board => ({
        id: board.id,
        title: board.title,
        taskCount: board.taskCount
      }));
    } catch (error) {
      console.error('Error getting board task counts:', error);
      return [];
    }
  }

  // Get license information for admin display
  async getLicenseInfo() {
    if (!this.enabled) {
      const isDemoMode = process.env.DEMO_ENABLED === 'true';
      return {
        enabled: false,
        message: isDemoMode 
          ? 'Licensing is disabled (demo mode - resets hourly)'
          : 'Licensing is disabled (self-hosted mode)'
      };
    }

    try {
      const limits = await this.getLimits();
      if (!limits) {
        return {
          enabled: true,
          message: 'License limits not configured'
        };
      }

      const users = await this.getUserCount();
      const boards = await this.getBoardCount();
      const totalTasks = await this.getTotalTaskCount();
      const storage = await this.getStorageUsage();
      const webhooks = await webhookQueries.countWebhooks(this.db);
      const effectiveStorage = this.getEffectiveStorageLimitBytes(limits);

      return {
        enabled: true,
        limits: limits,
        usage: {
          users,
          boards,
          totalTasks,
          storage,
          webhooks
        },
        limitsReached: {
          users: !isUnlimitedNumeric(limits.USER_LIMIT) && users >= limits.USER_LIMIT,
          boards: !isUnlimitedNumeric(limits.BOARD_LIMIT) && boards >= limits.BOARD_LIMIT,
          storage: effectiveStorage !== null && storage >= effectiveStorage,
          webhooks:
            limits.WEBHOOK_LIMIT !== undefined &&
            !isUnlimitedNumeric(limits.WEBHOOK_LIMIT) &&
            webhooks >= limits.WEBHOOK_LIMIT
        },
        boardTaskCounts: await this.getBoardTaskCounts()
      };
    } catch (error) {
      console.error('Error getting license info:', error);
      return {
        enabled: true,
        error: error.message
      };
    }
  }
}

// Cache LicenseManager instances per database
// In multi-tenant mode, each tenant needs its own LicenseManager instance
// Use a WeakMap to cache instances per database object
const licenseManagerCache = new WeakMap();

export const getLicenseManager = (db) => {
  if (!db) {
    throw new Error('Database is required for LicenseManager');
  }
  
  // Check if we already have a LicenseManager for this database
  if (licenseManagerCache.has(db)) {
    return licenseManagerCache.get(db);
  }
  
  // Create new LicenseManager instance for this database
  const licenseManager = new LicenseManager(db);
  licenseManagerCache.set(db, licenseManager);
  return licenseManager;
};

export default LicenseManager;
