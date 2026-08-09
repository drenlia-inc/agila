import express from 'express';
import { wrapQuery } from '../utils/queryLogger.js';
import { authenticateToken } from '../middleware/auth.js';
import { getLeaderboard } from '../jobs/achievements.js';
import { getTranslator, t as translate } from '../utils/i18n.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { reports as reportQueries } from '../utils/sqlManager/index.js';

const router = express.Router();

/** Enforce REPORTS_VISIBLE_TO=admin for non-settings report data routes */
async function requireReportsAccess(req, res, next) {
  try {
    const db = getRequestDatabase(req);
    const reportSettings = await reportQueries.getReportSettings(db);
    const settingsObj = {};
    reportSettings.forEach((row) => {
      settingsObj[row.key] = row.value;
    });
    if (settingsObj.REPORTS_ENABLED === 'false') {
      return res.status(403).json({ error: 'Reports are disabled' });
    }
    const visibleTo = settingsObj.REPORTS_VISIBLE_TO || 'all';
    if (visibleTo === 'admin') {
      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      const isAdmin = req.user?.role === 'admin' || roles.includes('admin');
      if (!isAdmin) {
        return res.status(403).json({ error: 'Reports are restricted to administrators' });
      }
    }
    next();
  } catch (error) {
    console.error('Reports access check failed:', error);
    return res.status(500).json({ error: 'Failed to verify report access' });
  }
}

/**
 * GET /api/reports/settings
 * Get report visibility settings (public endpoint for all authenticated users)
 */
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    
    // MIGRATED: Fetch report-related settings using sqlManager
    const reportSettings = await reportQueries.getReportSettings(db);
    
    const settingsObj = {};
    reportSettings.forEach(row => {
      settingsObj[row.key] = row.value;
    });
    
    // Return with defaults for any missing keys
    res.json({
      REPORTS_ENABLED: settingsObj.REPORTS_ENABLED || 'true',
      REPORTS_GAMIFICATION_ENABLED: settingsObj.REPORTS_GAMIFICATION_ENABLED || 'true',
      REPORTS_LEADERBOARD_ENABLED: settingsObj.REPORTS_LEADERBOARD_ENABLED || 'true',
      REPORTS_ACHIEVEMENTS_ENABLED: settingsObj.REPORTS_ACHIEVEMENTS_ENABLED || 'true',
      REPORTS_VISIBLE_TO: settingsObj.REPORTS_VISIBLE_TO || 'all'
    });
  } catch (error) {
    console.error('Failed to fetch report settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * GET /api/reports/user-points
 * Get points and achievements for current user or specified user
 * Query params: userId (optional, admin only)
 */
router.get('/user-points', authenticateToken, requireReportsAccess, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { userId, lang } = req.query;
    const targetUserId = userId || req.user.id;
    
    // Use user's language preference if provided, otherwise fall back to APP_LANGUAGE
    // lang parameter takes precedence over APP_LANGUAGE for user-facing content
    const userLanguage = (lang === 'fr' || lang === 'en') ? lang : null;
    
    // If requesting another user's points, check if admin
    if (userId && userId !== req.user.id && !req.user.roles?.includes('admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // MIGRATED: Fetch current user info using sqlManager
    const currentUserInfo = await reportQueries.getMemberInfoByUserId(db, targetUserId);
    
    if (!currentUserInfo) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // MIGRATED: Get user's total points using sqlManager
    const userPoints = await reportQueries.getUserTotalPoints(db, targetUserId);
    
    // MIGRATED: Get monthly breakdown using sqlManager
    const monthlyPoints = await reportQueries.getUserMonthlyPoints(db, targetUserId);
    
    // MIGRATED: Get achievements using sqlManager
    const achievementsRaw = await reportQueries.getUserAchievements(db, targetUserId);
    
    // Translate achievement names and descriptions
    // Use user's language preference if provided, otherwise use APP_LANGUAGE
    let translationLang = 'en';
    if (userLanguage) {
      translationLang = userLanguage;
    } else {
      // MIGRATED: Get APP_LANGUAGE setting using sqlManager
      const appLang = await reportQueries.getSettingByKey(db, 'APP_LANGUAGE');
      translationLang = (appLang?.value || 'EN').toUpperCase() === 'FR' ? 'fr' : 'en';
    }
    
    // Create translator function with the determined language
    const t = (key, params = {}) => translate(key, params, translationLang);
    
    const achievements = achievementsRaw.map(achievement => {
      const badgeId = achievement.badgeId;
      let translatedName = achievement.badgeName;
      let translatedDescription = achievement.badgeDescription || '';
      
      // Map badge IDs to translation keys (new system badges)
      const badgeIdToTranslationKey = {
        'getting-started': { name: 'achievements.names.gettingStarted', desc: 'achievements.descriptions.completedFirstTask' },
        'productive': { name: 'achievements.names.productive', desc: 'achievements.descriptions.completed10Tasks' },
        'achiever': { name: 'achievements.names.achiever', desc: 'achievements.descriptions.completed50Tasks' },
        'champion': { name: 'achievements.names.champion', desc: 'achievements.descriptions.completed100Tasks' },
        'unstoppable': { name: 'achievements.names.unstoppable', desc: 'achievements.descriptions.completed250Tasks' },
        'task-master': { name: 'achievements.names.taskMaster', desc: 'achievements.descriptions.created50Tasks' },
        'task-legend': { name: 'achievements.names.taskLegend', desc: 'achievements.descriptions.created100Tasks' },
        'team-player': { name: 'achievements.names.teamPlayer', desc: 'achievements.descriptions.added5Collaborators' },
        'collaborator': { name: 'achievements.names.collaborator', desc: 'achievements.descriptions.added25Collaborators' },
        'team-builder': { name: 'achievements.names.teamBuilder', desc: 'achievements.descriptions.added50Collaborators' },
        'communicator': { name: 'achievements.names.communicator', desc: 'achievements.descriptions.added10Comments' },
        'conversationalist': { name: 'achievements.names.conversationalist', desc: 'achievements.descriptions.added50Comments' },
        'commentator': { name: 'achievements.names.commentator', desc: 'achievements.descriptions.added100Comments' },
        'hard-worker': { name: 'achievements.names.hardWorker', desc: 'achievements.descriptions.completed50EffortPoints' },
        'powerhouse': { name: 'achievements.names.powerhouse', desc: 'achievements.descriptions.completed200EffortPoints' },
        'juggernaut': { name: 'achievements.names.juggernaut', desc: 'achievements.descriptions.completed500EffortPoints' },
        'observer': { name: 'achievements.names.observer', desc: 'achievements.descriptions.added10Watchers' },
        'watchful': { name: 'achievements.names.watchful', desc: 'achievements.descriptions.added50Watchers' },
        'first-task': { name: 'achievements.names.firstTask', desc: 'achievements.descriptions.createdFirstTask' },
        'task-creator': { name: 'achievements.names.taskCreator', desc: 'achievements.descriptions.created10Tasks' },
        'point-getter': { name: 'achievements.names.pointGetter', desc: 'achievements.descriptions.earned100Points' },
        'point-collector': { name: 'achievements.names.pointCollector', desc: 'achievements.descriptions.earned500Points' }
      };
      
      // Map old badge names to translation keys (fallback for old system badges without badge_id)
      const badgeNameToTranslationKey = {
        'Starter': { name: 'achievements.names.starter', desc: 'achievements.descriptions.completed10TasksStarter' },
        'Achiever': { name: 'achievements.names.achiever', desc: 'achievements.descriptions.completed50Tasks' },
        'Master': { name: 'achievements.names.master', desc: 'achievements.descriptions.completed200TasksMaster' },
        'Legend': { name: 'achievements.names.legend', desc: 'achievements.descriptions.completed500TasksLegend' },
        'Hard Worker': { name: 'achievements.names.hardWorker', desc: 'achievements.descriptions.completed100EffortPoints' },
        'Powerhouse': { name: 'achievements.names.powerhouse', desc: 'achievements.descriptions.completed500EffortPointsPowerhouse' },
        'Team Player': { name: 'achievements.names.teamPlayer', desc: 'achievements.descriptions.added50CollaboratorsTeamPlayer' },
        'Mentor': { name: 'achievements.names.mentor', desc: 'achievements.descriptions.added200CollaboratorsMentor' },
        'Communicator': { name: 'achievements.names.communicator', desc: 'achievements.descriptions.added100CommentsCommunicator' }
      };
      
      // First try to translate by badge_id (new system)
      if (badgeId && badgeIdToTranslationKey[badgeId]) {
        const translationKeys = badgeIdToTranslationKey[badgeId];
        translatedName = t(translationKeys.name);
        translatedDescription = t(translationKeys.desc);
      } 
      // Fallback: translate by badge_name (old system badges without badge_id)
      else if (badgeNameToTranslationKey[achievement.badgeName]) {
        const translationKeys = badgeNameToTranslationKey[achievement.badgeName];
        translatedName = t(translationKeys.name);
        translatedDescription = t(translationKeys.desc);
      }
      
      return {
        id: achievement.id,
        achievement_type: achievement.achievementType,
        badge_id: achievement.badgeId,
        badge_name: translatedName,
        badge_icon: achievement.badgeIcon,
        badge_color: achievement.badgeColor,
        points_earned: achievement.pointsEarned,
        earned_at: achievement.earnedAt || null, // Ensure earned_at is present, handle null
        badge_description: translatedDescription
      };
    });
    
    // MIGRATED: Get active members count using sqlManager
    const totalActiveMembers = await reportQueries.getActiveMembersCount(db);
    
    // Get user's rank among all active members
    const allUsers = await getLeaderboard(db);
    let userRank = allUsers.findIndex(u => u.user_id === targetUserId) + 1;
    
    // If user not in leaderboard (no activity yet), they're ranked last
    if (userRank === 0) {
      userRank = totalActiveMembers.count;
    }
    
    // Merge current user info with points data (normalize field names)
    const userStats = {
      user_id: currentUserInfo.userId,
      user_name: currentUserInfo.userName,
      total_points: userPoints?.totalPoints || 0,
      tasks_created: userPoints?.tasksCreated || 0,
      tasks_completed: userPoints?.tasksCompleted || 0,
      total_effort_completed: userPoints?.totalEffortCompleted || 0,
      comments_added: userPoints?.commentsAdded || 0,
      collaborations: userPoints?.collaborations || 0
    };
    
    res.json({
      success: true,
      user: userStats,
      rank: userRank,
      totalUsers: totalActiveMembers.count,
      monthlyBreakdown: monthlyPoints,
      achievements: achievements
    });
  } catch (error) {
    console.error('Error fetching user points:', error);
    res.status(500).json({ error: 'Failed to fetch user points' });
  }
});

/**
 * GET /api/reports/leaderboard
 * Get team rankings
 * Query params: year, month (optional)
 */
router.get('/leaderboard', authenticateToken, requireReportsAccess, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { year, month } = req.query;
    
    const leaderboard = await getLeaderboard(
      db,
      year ? parseInt(year) : null,
      month ? parseInt(month) : null
    );
    
    // MIGRATED: Get total active members using sqlManager
    const totalActiveMembers = await reportQueries.getActiveMembersCount(db);
    
    res.json({
      success: true,
      period: {
        year: year ? parseInt(year) : 'all-time',
        month: month ? parseInt(month) : null
      },
      totalMembers: totalActiveMembers.count,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /api/reports/burndown
 * Get burndown data for a planning period
 * Query params: startDate, endDate, boardId (optional)
 */
router.get('/burndown', authenticateToken, requireReportsAccess, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { startDate, endDate, boardId } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'startdate and endDate are required',
        example: '?startDate=2025-01-01&endDate=2025-01-31'
      });
    }
    
    // MIGRATED: Get burndown snapshots using sqlManager
    const snapshots = await reportQueries.getBurndownSnapshots(db, startDate, endDate, boardId);
    
    // MIGRATED: Get burndown baseline using sqlManager
    const baseline = await reportQueries.getBurndownBaseline(db, startDate, endDate, boardId);
    
    // Calculate calendar days in the selected period (inclusive of start and end dates)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const calendarDays = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
    
    // Calculate ideal burndown line based on calendar days
    const idealBurndown = [];
    
    if (baseline && calendarDays > 0) {
      const plannedTasks = baseline.plannedTasks || 0;
      const plannedEffort = baseline.plannedEffort || 0;
      const tasksPerDay = plannedTasks / calendarDays;
      const effortPerDay = plannedEffort / calendarDays;
      
      // Create ideal burndown for each snapshot date, calculating progress based on days elapsed
      snapshots.forEach((snapshot) => {
        // Calculate days elapsed from start date to this snapshot date
        const snapshotDate = new Date(snapshot.snapshotDate);
        const daysElapsed = Math.floor((snapshotDate - start) / (1000 * 60 * 60 * 24)) + 1; // +1 to include start date
        
        idealBurndown.push({
          date: snapshot.snapshotDate,
          idealRemainingTasks: Math.max(0, plannedTasks - (tasksPerDay * daysElapsed)),
          idealRemainingEffort: Math.max(0, plannedEffort - (effortPerDay * daysElapsed))
        });
      });
    }
    
    // Calculate actual remaining tasks (normalize field names and convert to numbers)
    const actualBurndown = snapshots.map(snapshot => {
      // Ensure snapshotDate is in YYYY-MM-DD format (PostgreSQL DATE returns as string)
      const dateStr = snapshot.snapshotDate instanceof Date 
        ? snapshot.snapshotDate.toISOString().split('T')[0]
        : String(snapshot.snapshotDate).split('T')[0]; // Handle both Date objects and strings
      
      const totalTasks = Number(snapshot.totalTasks) || 0;
      const completedTasks = Number(snapshot.completedTasks) || 0;
      const totalEffort = Number(snapshot.totalEffort) || 0;
      const completedEffort = Number(snapshot.completedEffort) || 0;
      
      return {
        date: dateStr,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        remaining_tasks: totalTasks - completedTasks,
        total_effort: totalEffort,
        completed_effort: completedEffort,
        remaining_effort: totalEffort - completedEffort
      };
    });
    
    // If no boardId filter, get per-board breakdown
    let boardsData = [];
    if (!boardId) {
      // MIGRATED: Get boards in date range using sqlManager
      const boards = await reportQueries.getBoardsInDateRange(db, startDate, endDate);
      
      // MIGRATED: Get data for each board using sqlManager
      boardsData = await Promise.all(boards.map(async board => {
        const boardSnapshots = await reportQueries.getBoardBurndownSnapshots(db, startDate, endDate, board.boardId);
        
        const boardData = boardSnapshots.map(snapshot => {
          // Ensure snapshotDate is in YYYY-MM-DD format
          const dateStr = snapshot.snapshotDate instanceof Date 
            ? snapshot.snapshotDate.toISOString().split('T')[0]
            : String(snapshot.snapshotDate).split('T')[0];
          
          const totalTasks = Number(snapshot.totalTasks) || 0;
          const completedTasks = Number(snapshot.completedTasks) || 0;
          const totalEffort = Number(snapshot.totalEffort) || 0;
          const completedEffort = Number(snapshot.completedEffort) || 0;
          
          return {
            date: dateStr,
            total_tasks: totalTasks,
            completed_tasks: completedTasks,
            remaining_tasks: totalTasks - completedTasks,
            total_effort: totalEffort,
            completed_effort: completedEffort,
            remaining_effort: totalEffort - completedEffort
          };
        });
        
        return {
          boardId: board.boardId,
          boardName: board.boardName,
          data: boardData
        };
      }));
    }
    
    res.json({
      success: true,
      period: {
        startDate,
        endDate,
        boardId: boardId || 'all'
      },
      baseline: baseline || { planned_tasks: 0, planned_effort: 0, plannedTasks: 0, plannedEffort: 0 },
      idealBurndown,
      actualBurndown,
      boards: boardsData, // NEW: Per-board breakdown
      metrics: {
        totalTasks: Number(baseline?.plannedTasks || baseline?.planned_tasks || 0),
        totalEffort: Number(baseline?.plannedEffort || baseline?.planned_effort || 0),
        totalDays: calendarDays
      },
      data: actualBurndown,
      summary: {
        totalDays: calendarDays,
        tasksPlanned: Number(baseline?.plannedTasks || baseline?.planned_tasks || 0),
        tasksCompleted: Number(snapshots[snapshots.length - 1]?.completedTasks || snapshots[snapshots.length - 1]?.completed_tasks || 0),
        effortPlanned: Number(baseline?.plannedEffort || baseline?.planned_effort || 0),
        effortCompleted: Number(snapshots[snapshots.length - 1]?.completedEffort || snapshots[snapshots.length - 1]?.completed_effort || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching burndown data:', error);
    res.status(500).json({ error: 'Failed to fetch burndown data' });
  }
});

/**
 * GET /api/reports/team-performance
 * Get team performance metrics
 * Query params: startDate, endDate, boardId (optional)
 */
router.get('/team-performance', authenticateToken, requireReportsAccess, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { startDate, endDate, boardId } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'startdate and endDate are required',
        example: '?startDate=2025-01-01&endDate=2025-01-31'
      });
    }
    
    // MIGRATED: Get activity events using sqlManager
    const activities = await reportQueries.getActivityEvents(db, startDate, endDate, boardId);
    
    // Aggregate by user
    const userPerformance = {};
    
    activities.forEach(activity => {
      // Normalize field names from camelCase to snake_case for compatibility
      const userId = activity.userId;
      const userName = activity.userName;
      const eventType = activity.eventType;
      // Convert to numbers to prevent string concatenation
      const eventCount = Number(activity.eventCount) || 0;
      const totalEffortCompleted = Number(activity.totalEffortCompleted) || 0;
      
      if (!userPerformance[userId]) {
        userPerformance[userId] = {
          user_id: userId,
          user_name: userName,
          tasks_created: 0,
          tasks_completed: 0,
          tasks_updated: 0,
          tasks_moved: 0,
          comments_added: 0,
          collaborations: 0,
          total_effort_completed: 0,
          total_points: 0
        };
      }
      
      const user = userPerformance[userId];
      
      switch (eventType) {
        case 'task_created':
          user.tasks_created += eventCount;
          break;
        case 'task_completed':
          user.tasks_completed += eventCount;
          user.total_effort_completed += totalEffortCompleted;
          break;
        case 'task_updated':
          user.tasks_updated += eventCount;
          break;
        case 'task_moved':
          user.tasks_moved += eventCount;
          break;
        case 'comment_added':
          user.comments_added += eventCount;
          break;
        case 'collaborator_added':
        case 'watcher_added':
          user.collaborations += eventCount;
          break;
      }
    });
    
    // Convert to array and sort by tasks completed
    const performanceArray = Object.values(userPerformance).sort((a, b) => 
      b.tasks_completed - a.tasks_completed
    );
    
    // MIGRATED: Get total points for each user using sqlManager
    for (const user of performanceArray) {
      const currentYear = new Date(startDate).getFullYear();
      const currentMonth = new Date(startDate).getMonth() + 1;
      
      const pointsData = await reportQueries.getUserPointsForPeriod(db, user.user_id, currentYear, currentMonth);
      
      user.total_points = pointsData?.totalPoints || 0;
    }
    
    res.json({
      success: true,
      period: {
        startDate,
        endDate,
        boardId: boardId || 'all'
      },
      users: performanceArray,
      summary: {
        totalUsers: performanceArray.length,
        totalTasksCompleted: performanceArray.reduce((sum, u) => sum + u.tasks_completed, 0),
        totalEffortCompleted: performanceArray.reduce((sum, u) => sum + u.total_effort_completed, 0),
        totalComments: performanceArray.reduce((sum, u) => sum + u.comments_added, 0),
        totalCollaborations: performanceArray.reduce((sum, u) => sum + u.collaborations, 0)
      }
    });
  } catch (error) {
    console.error('Error fetching team performance:', error);
    res.status(500).json({ error: 'Failed to fetch team performance' });
  }
});

/**
 * GET /api/reports/task-list
 * Get comprehensive task list with metrics
 * Query params: startDate, endDate, boardId, status, assigneeId, priorityName (all optional)
 */
router.get('/task-list', authenticateToken, requireReportsAccess, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { startDate, endDate, boardId, status, assigneeId, priorityName } = req.query;
    
    // MIGRATED: Get priority ID if priorityName is provided
    let priorityId = null;
    if (priorityName) {
      const priority = await reportQueries.getPriorityByName(db, priorityName);
      priorityId = priority?.id || null;
    }
    
    // MIGRATED: Get task list using sqlManager
    const tasks = await reportQueries.getTaskList(db, {
      startDate,
      endDate,
      boardId,
      status,
      assigneeId,
      priorityId
    });
    
    // MIGRATED: Get tags for each task using sqlManager
    const tasksWithTags = await Promise.all(tasks.map(async task => {
      const tags = await reportQueries.getTagsForTask(db, task.id);
      
      // Normalize field names from camelCase to snake_case for API response
      return {
        task_id: task.id,
        task_ticket: task.ticket,
        task_title: task.title,
        board_name: task.boardName,
        column_name: task.columnName,
        assignee_name: task.assigneeName,
        requester_name: task.requesterName,
        priority_name: task.priorityName || task.priority, // Use current name from JOIN or fallback to stored name
        effort: task.effort,
        start_date: task.startDate,
        due_date: task.dueDate,
        is_completed: task.isFinished === true || task.isFinished === 1,
        tags,
        comment_count: task.commentCount,
        created_at: task.createdAt,
        completed_at: (task.isFinished === true || task.isFinished === 1) ? task.updatedAt : null
      };
    }));
    
    // Calculate metrics
    const metrics = {
      totalTasks: tasksWithTags.length,
      completedTasks: tasksWithTags.filter(t => t.is_completed).length,
      activeTasks: tasksWithTags.filter(t => !t.is_completed).length,
      totalEffort: tasksWithTags.reduce((sum, t) => sum + (t.effort || 0), 0),
      completedEffort: tasksWithTags.filter(t => t.is_completed).reduce((sum, t) => sum + (t.effort || 0), 0),
      totalComments: tasksWithTags.reduce((sum, t) => sum + t.comment_count, 0),
      avgCommentsPerTask: tasksWithTags.length > 0 ? 
        (tasksWithTags.reduce((sum, t) => sum + t.comment_count, 0) / tasksWithTags.length).toFixed(1) : 0
    };
    
    res.json({
      success: true,
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        boardId: boardId || null,
        status: status || null,
        assigneeId: assigneeId || null,
        priorityName: priorityName || null
      },
      metrics,
      tasks: tasksWithTags
    });
  } catch (error) {
    console.error('Error fetching task list:', error);
    res.status(500).json({ error: 'Failed to fetch task list' });
  }
});

export default router;

