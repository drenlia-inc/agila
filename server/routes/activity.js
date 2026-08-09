import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { activity as activityQueries } from '../utils/sqlManager/index.js';

const router = express.Router();

// Activity Feed endpoint
router.get('/feed', authenticateToken, async (req, res) => {
  const { limit = 20, lang } = req.query;
  const db = getRequestDatabase(req);
  
  try {
    // Get user's language preference (from query param, user preferences, or default to 'en')
    let userLanguage = lang || 'en';
    
    // If no language in query, try to get from user preferences
    if (!lang && req.user?.id) {
      try {
        const { users } = await import('../utils/sqlManager/index.js');
        const userPrefs = await users.getUserPreferences(db, req.user.id);
        if (userPrefs?.language) {
          userLanguage = userPrefs.language;
        }
      } catch (prefError) {
        // Fall back to default
        console.warn('Failed to get user language preference:', prefError.message);
      }
    }
    
    // MIGRATED: Get activity feed using sqlManager with user's language
    const activities = await activityQueries.getActivityFeed(db, parseInt(limit), userLanguage);
    
    res.json(activities);
  } catch (error) {
    console.error('Error fetching activity feed:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

// User Status endpoint for permission refresh
router.get('/status', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Get user status using sqlManager
    const user = await activityQueries.getUserStatus(db, userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
    const canMutate = roles.includes('admin') || roles.includes('user') || user.role === 'admin' || user.role === 'user';
    res.json({
      isActive: Boolean(user.isActive),
      isAdmin: user.role === 'admin' || roles.includes('admin'),
      isViewer: user.role === 'viewer' || (roles.includes('viewer') && !canMutate),
      canMutate,
      roles,
      forceLogout: !user.isActive || Boolean(user.forceLogout) // Force logout if user is deactivated or role changed
    });
  } catch (error) {
    console.error('Error fetching user status:', error);
    res.status(500).json({ error: 'Failed to fetch user status' });
  }
});

export default router;

