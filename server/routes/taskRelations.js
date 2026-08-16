import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { authenticateToken, userCanMutate } from '../middleware/auth.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { logActivity, logTaskActivity } from '../services/activityLogger.js';
import { TAG_ACTIONS } from '../constants/activityActions.js';
import * as reportingLogger from '../services/reportingLogger.js';
import notificationService from '../services/notificationService.js';
import { updateStorageUsage } from '../utils/storageUtils.js';
import { getLicenseManager } from '../config/license.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
import { helpers, tasks as taskQueries, files as fileQueries, activity as activityQueries, members as memberQueries } from '../utils/sqlManager/index.js';
import { getBilingualTranslation, getTranslatorForLanguage, getTranslator } from '../utils/i18n.js';
import { notifyCollaboratorAdded, notifyWatcherAdded } from '../services/taskEmailNotificationService.js';
import { parseBody, taskAttachmentsBodySchema } from '../utils/requestValidation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// Task-Tag association endpoints
router.get('/:taskId/tags', authenticateToken, async (req, res) => {
  const { taskId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Use sqlManager to get tags for task
    const taskTags = await helpers.getTagsForTask(db, taskId);
    
    res.json(taskTags);
  } catch (error) {
    console.error('Error fetching task tags:', error);
    res.status(500).json({ error: 'Failed to fetch task tags' });
  }
});

router.post('/:taskId/tags/:tagId', authenticateToken, async (req, res) => {
  const { taskId, tagId } = req.params;
  const userId = req.user?.id || 'system';
  const db = getRequestDatabase(req);
  const skipEmail =
    req.query.skipEmail === 'true' ||
    req.query.skipEmail === '1' ||
    req.body?.skipEmail === true;
  
  try {
    // MIGRATED: Check if association already exists using sqlManager
    const existing = await helpers.checkTagAssociation(db, taskId, parseInt(tagId));
    
    if (existing) {
      return res.status(409).json({ error: 'Tag already associated with this task' });
    }
    
    // MIGRATED: Get tag and task details for logging and WebSocket event
    const tag = await helpers.getTagById(db, parseInt(tagId));
    // MIGRATED: Get task info using sqlManager (returns camelCase)
    const task = await taskQueries.getTaskById(db, taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Normalize snake_case to camelCase for consistency
    const normalizedTask = {
      ...task,
      columnId: task.columnid || task.columnId,
      boardId: task.boardid || task.boardId
    };
    
    // MIGRATED: Add tag to task using sqlManager
    await helpers.addTagToTask(db, taskId, parseInt(tagId));
    
    // Log tag association activity
    if (tag && normalizedTask) {
      // Get board info and task ticket for bilingual activity message
      (async () => {
        try {
          const taskInfo = await activityQueries.getTaskInfoForActivity(db, taskId);
          const taskDetails = await activityQueries.getTaskDetailsForActivity(db, taskId);
          
          const boardTitle = taskInfo?.boardTitle || 'Unknown Board';
          const taskTitle = taskInfo?.title || normalizedTask.title;
          const taskTicket = taskDetails?.ticket || null;
          const taskRef = taskTicket ? ` (${taskTicket})` : '';
          
          // Get bilingual translations
          const tEn = getTranslatorForLanguage('en');
          const tFr = getTranslatorForLanguage('fr');
          
          const unknownBoardEn = tEn('activity.unknownBoard');
          const unknownBoardFr = tFr('activity.unknownBoard');
          
          const translatedBoardTitle = {
            en: boardTitle === 'Unknown Board' ? unknownBoardEn : boardTitle,
            fr: boardTitle === 'Unknown Board' ? unknownBoardFr : boardTitle
          };
          
          // Generate bilingual message
          const bilingualDetails = {
            en: tEn('activity.associatedTag', {
              tagName: tag.tag,
              taskTitle: taskTitle,
              taskRef: taskRef,
              boardTitle: translatedBoardTitle.en
            }),
            fr: tFr('activity.associatedTag', {
              tagName: tag.tag,
              taskTitle: taskTitle,
              taskRef: taskRef,
              boardTitle: translatedBoardTitle.fr
            })
          };
          
          // Fire-and-forget: Don't await activity logging to avoid blocking API response
          await logTaskActivity(
            userId,
            TAG_ACTIONS.ASSOCIATE,
            taskId,
            JSON.stringify(bilingualDetails),
            {
              tagId: parseInt(tagId),
              columnId: normalizedTask.columnId,
              boardId: normalizedTask.boardId,
              tenantId: getTenantId(req),
              authType: req.user?.authType,
              db: db,
              skipEmail: skipEmail === true,
              emailChange: {
                items: [
                  {
                    field: 'tags',
                    added: [{ name: tag.tag, color: tag.color }],
                    removed: [],
                  },
                ],
              },
            }
          );
        } catch (error) {
          console.error('Background activity logging failed:', error);
        }
      })();
      
      // Log to reporting system
      try {
        const userInfo = await reportingLogger.getUserInfo(db, userId);
        // MIGRATED: Get task info with board/column titles for reporting
        const taskInfo = await taskQueries.getTaskWithBoardColumnInfo(db, taskId);
        
        if (userInfo && taskInfo) {
          // Normalize snake_case to camelCase
          const normalizedTaskInfo = {
            ...taskInfo,
            boardId: taskInfo.board_id || taskInfo.boardid || taskInfo.boardId,
            columnId: taskInfo.columnid || taskInfo.columnId
          };
          
          await reportingLogger.logActivity(db, {
            eventType: 'tag_added',
            userId: userInfo.id,
            userName: userInfo.name,
            userEmail: userInfo.email,
            taskId: normalizedTaskInfo.id,
            taskTitle: normalizedTaskInfo.title,
            taskTicket: normalizedTaskInfo.ticket,
            boardId: normalizedTaskInfo.boardId,
            boardName: normalizedTaskInfo.board_title,
            columnId: normalizedTaskInfo.columnId,
            columnName: normalizedTaskInfo.column_title,
            effortPoints: normalizedTaskInfo.effort,
            priorityName: normalizedTaskInfo.priority,
            metadata: { tagName: tag.tag }
          });
        }
      } catch (reportError) {
        console.error('Failed to log tag to reporting system:', reportError);
      }
    }
    
    // Publish to notification service for real-time updates
    if (normalizedTask?.boardId) {
      const tenantId = getTenantId(req);
      
      // Publish board-specific event for immediate updates (users viewing the board)
      const publishData = {
        boardId: normalizedTask.boardId,
        taskId: taskId,
        tagId: parseInt(tagId),
        tag: tag,
        timestamp: new Date().toISOString()
      };
      console.log('📤 Publishing task-tag-added for board:', normalizedTask.boardId, 'tenant:', tenantId, 'data:', publishData);
      await notificationService.publish('task-tag-added', publishData, tenantId);
      console.log('✅ Task-tag-added published successfully');
      
      // Also publish task-updated event for all users in tenant (so users not viewing the board get updates)
      // This ensures users see correct tags when they switch to the board
      try {
        const updatedTask = await taskQueries.getTaskWithRelationships(db, taskId);
        if (updatedTask) {
          // Parse JSON fields (PostgreSQL returns JSON as objects/arrays, but handle both)
          const parseJsonField = (field) => {
            if (field === null || field === undefined || field === '' || field === '[null]' || field === 'null') {
              return [];
            }
            if (Array.isArray(field)) {
              return field.filter(Boolean);
            }
            if (typeof field === 'object') {
              return Array.isArray(field) ? field.filter(Boolean) : [field].filter(Boolean);
            }
            if (typeof field === 'string') {
              const trimmed = field.trim();
              if (!trimmed || trimmed === '[]' || trimmed === '[null]' || trimmed === 'null') {
                return [];
              }
              try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.filter(Boolean) : (parsed ? [parsed] : []);
              } catch (e) {
                return [];
              }
            }
            return [];
          };
          
          // Deduplicate arrays by id
          const deduplicateById = (arr) => {
            const seen = new Set();
            return arr.filter(item => {
              if (!item || !item.id) return false;
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          };
          
          updatedTask.tags = deduplicateById(parseJsonField(updatedTask.tags));
          updatedTask.watchers = deduplicateById(parseJsonField(updatedTask.watchers));
          updatedTask.collaborators = deduplicateById(parseJsonField(updatedTask.collaborators));
          updatedTask.comments = deduplicateById(parseJsonField(updatedTask.comments));
          
          // Use priorityName from JOIN (current name) or fallback to stored priority
          updatedTask.priority = updatedTask.priorityName || updatedTask.priority || null;
          updatedTask.priorityId = updatedTask.priorityId || null;
          updatedTask.priorityName = updatedTask.priorityName || updatedTask.priority || null;
          updatedTask.priorityColor = updatedTask.priorityColor || null;
          
          // Normalize field names for frontend
          updatedTask.boardId = updatedTask.boardid || updatedTask.boardId;
          updatedTask.columnId = updatedTask.columnid || updatedTask.columnId;
          updatedTask.memberId = updatedTask.memberid || updatedTask.memberId;
          updatedTask.requesterId = updatedTask.requesterid || updatedTask.requesterId;
          
          await notificationService.publish('task-updated', {
            boardId: normalizedTask.boardId,
            task: updatedTask,
            timestamp: new Date().toISOString()
          }, tenantId);
          console.log('✅ Task-updated published for tag addition (all tenant users will receive update)');
        }
      } catch (updateError) {
        console.error('⚠️ Failed to publish task-updated event for tag addition:', updateError);
        // Don't fail the request if this fails
      }
    } else {
      console.warn('⚠️ Cannot publish task-tag-added: task.boardId is missing', { task: normalizedTask, taskId });
    }
    
    res.json({ message: 'Tag added to task successfully' });
  } catch (error) {
    console.error('Error adding tag to task:', error);
    res.status(500).json({ error: 'Failed to add tag to task' });
  }
});

router.delete('/:taskId/tags/:tagId', authenticateToken, async (req, res) => {
  const { taskId, tagId } = req.params;
  const userId = req.user?.id || 'system';
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Get tag and task details for logging before deletion
    const tag = await helpers.getTagById(db, parseInt(tagId));
    // MIGRATED: Get task info using sqlManager (returns camelCase)
    const task = await taskQueries.getTaskById(db, taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Normalize snake_case to camelCase for consistency
    const normalizedTask = {
      ...task,
      columnId: task.columnid || task.columnId,
      boardId: task.boardid || task.boardId
    };
    
    // MIGRATED: Remove tag from task using sqlManager
    const result = await helpers.removeTagFromTask(db, taskId, parseInt(tagId));
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Tag association not found' });
    }
    
    // Log tag disassociation activity
    if (tag && normalizedTask) {
      // Get board info and task ticket for bilingual activity message
      (async () => {
        try {
          const taskInfo = await activityQueries.getTaskInfoForActivity(db, taskId);
          const taskDetails = await activityQueries.getTaskDetailsForActivity(db, taskId);
          
          const boardTitle = taskInfo?.boardTitle || 'Unknown Board';
          const taskTitle = taskInfo?.title || normalizedTask.title;
          const taskTicket = taskDetails?.ticket || null;
          const taskRef = taskTicket ? ` (${taskTicket})` : '';
          
          // Get bilingual translations
          const tEn = getTranslatorForLanguage('en');
          const tFr = getTranslatorForLanguage('fr');
          
          const unknownBoardEn = tEn('activity.unknownBoard');
          const unknownBoardFr = tFr('activity.unknownBoard');
          
          const translatedBoardTitle = {
            en: boardTitle === 'Unknown Board' ? unknownBoardEn : boardTitle,
            fr: boardTitle === 'Unknown Board' ? unknownBoardFr : boardTitle
          };
          
          // Generate bilingual message
          const bilingualDetails = {
            en: tEn('activity.removedTag', {
              tagName: tag.tag,
              taskTitle: taskTitle,
              taskRef: taskRef,
              boardTitle: translatedBoardTitle.en
            }),
            fr: tFr('activity.removedTag', {
              tagName: tag.tag,
              taskTitle: taskTitle,
              taskRef: taskRef,
              boardTitle: translatedBoardTitle.fr
            })
          };
          
          // Fire-and-forget: Don't await activity logging to avoid blocking API response
          await logTaskActivity(
            userId,
            TAG_ACTIONS.DISASSOCIATE,
            taskId,
            JSON.stringify(bilingualDetails),
            {
              tagId: parseInt(tagId),
              columnId: normalizedTask.columnId,
              boardId: normalizedTask.boardId,
              tenantId: getTenantId(req),
              authType: req.user?.authType,
              db: db,
              emailChange: {
                items: [
                  {
                    field: 'tags',
                    added: [],
                    removed: [{ name: tag.tag, color: tag.color }],
                  },
                ],
              },
            }
          );
        } catch (error) {
          console.error('Background activity logging failed:', error);
        }
      })();
    }
    
    // Publish to Redis for real-time updates
    if (normalizedTask?.boardId) {
      const tenantId = getTenantId(req);
      
      // Publish board-specific event for immediate updates (users viewing the board)
      console.log('📤 Publishing task-tag-removed to Redis for board:', normalizedTask.boardId);
      await notificationService.publish('task-tag-removed', {
        boardId: normalizedTask.boardId,
        taskId: taskId,
        tagId: parseInt(tagId),
        tag: tag,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ Task-tag-removed published to Redis');
      
      // Also publish task-updated event for all users in tenant (so users not viewing the board get updates)
      // This ensures users see correct tags when they switch to the board
      try {
        const updatedTask = await taskQueries.getTaskWithRelationships(db, taskId);
        if (updatedTask) {
          // Parse JSON fields (PostgreSQL returns JSON as objects/arrays, but handle both)
          const parseJsonField = (field) => {
            if (field === null || field === undefined || field === '' || field === '[null]' || field === 'null') {
              return [];
            }
            if (Array.isArray(field)) {
              return field.filter(Boolean);
            }
            if (typeof field === 'object') {
              return Array.isArray(field) ? field.filter(Boolean) : [field].filter(Boolean);
            }
            if (typeof field === 'string') {
              const trimmed = field.trim();
              if (!trimmed || trimmed === '[]' || trimmed === '[null]' || trimmed === 'null') {
                return [];
              }
              try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.filter(Boolean) : (parsed ? [parsed] : []);
              } catch (e) {
                return [];
              }
            }
            return [];
          };
          
          // Deduplicate arrays by id
          const deduplicateById = (arr) => {
            const seen = new Set();
            return arr.filter(item => {
              if (!item || !item.id) return false;
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          };
          
          updatedTask.tags = deduplicateById(parseJsonField(updatedTask.tags));
          updatedTask.watchers = deduplicateById(parseJsonField(updatedTask.watchers));
          updatedTask.collaborators = deduplicateById(parseJsonField(updatedTask.collaborators));
          updatedTask.comments = deduplicateById(parseJsonField(updatedTask.comments));
          
          // Use priorityName from JOIN (current name) or fallback to stored priority
          updatedTask.priority = updatedTask.priorityName || updatedTask.priority || null;
          updatedTask.priorityId = updatedTask.priorityId || null;
          updatedTask.priorityName = updatedTask.priorityName || updatedTask.priority || null;
          updatedTask.priorityColor = updatedTask.priorityColor || null;
          
          // Normalize field names for frontend
          updatedTask.boardId = updatedTask.boardid || updatedTask.boardId;
          updatedTask.columnId = updatedTask.columnid || updatedTask.columnId;
          updatedTask.memberId = updatedTask.memberid || updatedTask.memberId;
          updatedTask.requesterId = updatedTask.requesterid || updatedTask.requesterId;
          
          await notificationService.publish('task-updated', {
            boardId: normalizedTask.boardId,
            task: updatedTask,
            timestamp: new Date().toISOString()
          }, tenantId);
          console.log('✅ Task-updated published for tag removal (all tenant users will receive update)');
        }
      } catch (updateError) {
        console.error('⚠️ Failed to publish task-updated event for tag removal:', updateError);
        // Don't fail the request if this fails
      }
    }
    
    res.json({ message: 'Tag removed from task successfully' });
  } catch (error) {
    console.error('Error removing tag from task:', error);
    res.status(500).json({ error: 'Failed to remove tag from task' });
  }
});

// Task-Watchers association endpoints
router.get('/:taskId/watchers', authenticateToken, async (req, res) => {
  const { taskId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Use sqlManager to get watchers for task
    const watchers = await helpers.getWatchersForTask(db, taskId);
    
    res.json(watchers);
  } catch (error) {
    console.error('Error fetching task watchers:', error);
    res.status(500).json({ error: 'Failed to fetch task watchers' });
  }
});

router.post('/:taskId/watchers/:memberId', authenticateToken, async (req, res) => {
  const { taskId, memberId } = req.params;
  const userId = req.user?.id || 'system';
  const db = getRequestDatabase(req);
  const skipEmail =
    req.query.skipEmail === 'true' ||
    req.query.skipEmail === '1' ||
    req.body?.skipEmail === true;
  
  try {
    if (!userCanMutate(req.user)) {
      const tTranslator = await getTranslator(db);
      const ownMember = await memberQueries.getMemberByUserId(db, userId);
      if (!ownMember || ownMember.id !== memberId) {
        return res.status(403).json({ error: tTranslator('errors.readOnly'), code: 'READ_ONLY' });
      }
    }
    // MIGRATED: Check if association already exists using sqlManager
    // Note: addWatcher uses ON CONFLICT DO NOTHING, so we check first
    const existingWatchers = await helpers.getWatchersForTask(db, taskId);
    const existing = existingWatchers.find(w => w.id === memberId);
    
    if (existing) {
      return res.status(409).json({ error: 'Member is already watching this task' });
    }
    
    // MIGRATED: Add watcher using sqlManager
    await helpers.addWatcher(db, taskId, memberId);

    if (!skipEmail) {
      notifyWatcherAdded(
        db,
        { actorUserId: userId, taskId, memberId },
        getTenantId(req)
      ).catch((err) => {
        console.error('Failed to send watcher-added email:', err);
      });
    }
    
    // Log to reporting system
    try {
      const userInfo = await reportingLogger.getUserInfo(db, userId);
      // MIGRATED: Get task info with board/column titles for reporting
      const taskInfo = await taskQueries.getTaskWithBoardColumnInfo(db, taskId);
      
      if (userInfo && taskInfo) {
        // Normalize snake_case to camelCase
        const normalizedTaskInfo = {
          ...taskInfo,
          boardId: taskInfo.board_id || taskInfo.boardid || taskInfo.boardId,
          columnId: taskInfo.columnid || taskInfo.columnId
        };
        
        await reportingLogger.logActivity(db, {
          eventType: 'watcher_added',
          userId: userInfo.id,
          userName: userInfo.name,
          userEmail: userInfo.email,
          taskId: normalizedTaskInfo.id,
          taskTitle: normalizedTaskInfo.title,
          taskTicket: normalizedTaskInfo.ticket,
          boardId: normalizedTaskInfo.boardId,
          boardName: normalizedTaskInfo.board_title,
          columnId: normalizedTaskInfo.columnId,
          columnName: normalizedTaskInfo.column_title,
          effortPoints: normalizedTaskInfo.effort,
          priorityName: normalizedTaskInfo.priority
        });
      }
    } catch (reportError) {
      console.error('Failed to log watcher to reporting system:', reportError);
    }
    
    res.json({ message: 'Watcher added to task successfully' });
  } catch (error) {
    console.error('Error adding watcher to task:', error);
    res.status(500).json({ error: 'Failed to add watcher to task' });
  }
});

router.delete('/:taskId/watchers/:memberId', authenticateToken, async (req, res) => {
  const { taskId, memberId } = req.params;
  const db = getRequestDatabase(req);
  const userId = req.user?.id || 'system';
  
  try {
    if (!userCanMutate(req.user)) {
      const tTranslator = await getTranslator(db);
      const ownMember = await memberQueries.getMemberByUserId(db, userId);
      if (!ownMember || ownMember.id !== memberId) {
        return res.status(403).json({ error: tTranslator('errors.readOnly'), code: 'READ_ONLY' });
      }
    }
    // MIGRATED: Remove watcher using sqlManager
    const result = await helpers.removeWatcher(db, taskId, memberId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Watcher association not found' });
    }
    
    res.json({ message: 'Watcher removed from task successfully' });
  } catch (error) {
    console.error('Error removing watcher from task:', error);
    res.status(500).json({ error: 'Failed to remove watcher from task' });
  }
});

// Task-Collaborators association endpoints
router.get('/:taskId/collaborators', authenticateToken, async (req, res) => {
  const { taskId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Use sqlManager to get collaborators for task
    const collaborators = await helpers.getCollaboratorsForTask(db, taskId);
    
    res.json(collaborators);
  } catch (error) {
    console.error('Error fetching task collaborators:', error);
    res.status(500).json({ error: 'Failed to fetch task collaborators' });
  }
});

router.post('/:taskId/collaborators/:memberId', authenticateToken, async (req, res) => {
  const { taskId, memberId } = req.params;
  const userId = req.user?.id || 'system';
  const db = getRequestDatabase(req);
  const skipEmail =
    req.query.skipEmail === 'true' ||
    req.query.skipEmail === '1' ||
    req.body?.skipEmail === true;
  
  try {
    // MIGRATED: Check if association already exists using sqlManager
    // Note: addCollaborator uses ON CONFLICT DO NOTHING, so we check first
    const existingCollaborators = await helpers.getCollaboratorsForTask(db, taskId);
    const existing = existingCollaborators.find(c => c.id === memberId);
    
    if (existing) {
      return res.status(409).json({ error: 'Member is already collaborating on this task' });
    }
    
    // MIGRATED: Add collaborator using sqlManager
    await helpers.addCollaborator(db, taskId, memberId);

    if (!skipEmail) {
      notifyCollaboratorAdded(
        db,
        { actorUserId: userId, taskId, memberId },
        getTenantId(req)
      ).catch((err) => {
        console.error('Failed to send collaborator-added email:', err);
      });
    }
    // Log to reporting system
    try {
      const userInfo = await reportingLogger.getUserInfo(db, userId);
      // MIGRATED: Get task info with board/column titles for reporting
      const taskInfo = await taskQueries.getTaskWithBoardColumnInfo(db, taskId);
      
      if (userInfo && taskInfo) {
        // Normalize snake_case to camelCase
        const normalizedTaskInfo = {
          ...taskInfo,
          boardId: taskInfo.board_id || taskInfo.boardid || taskInfo.boardId,
          columnId: taskInfo.columnid || taskInfo.columnId
        };
        
        await reportingLogger.logActivity(db, {
          eventType: 'collaborator_added',
          userId: userInfo.id,
          userName: userInfo.name,
          userEmail: userInfo.email,
          taskId: normalizedTaskInfo.id,
          taskTitle: normalizedTaskInfo.title,
          taskTicket: normalizedTaskInfo.ticket,
          boardId: normalizedTaskInfo.boardId,
          boardName: normalizedTaskInfo.board_title,
          columnId: normalizedTaskInfo.columnId,
          columnName: normalizedTaskInfo.column_title,
          effortPoints: normalizedTaskInfo.effort,
          priorityName: normalizedTaskInfo.priority
        });
      }
    } catch (reportError) {
      console.error('Failed to log collaborator to reporting system:', reportError);
    }
    
    res.json({ message: 'Collaborator added to task successfully' });
  } catch (error) {
    console.error('Error adding collaborator to task:', error);
    res.status(500).json({ error: 'Failed to add collaborator to task' });
  }
});

router.delete('/:taskId/collaborators/:memberId', authenticateToken, async (req, res) => {
  const { taskId, memberId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Remove collaborator using sqlManager
    const result = await helpers.removeCollaborator(db, taskId, memberId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Collaborator association not found' });
    }
    
    res.json({ message: 'Collaborator removed from task successfully' });
  } catch (error) {
    console.error('Error removing collaborator from task:', error);
    res.status(500).json({ error: 'Failed to remove collaborator from task' });
  }
});

// Task-Attachments association endpoints
router.get('/:taskId/attachments', authenticateToken, async (req, res) => {
  const { taskId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Use sqlManager to get attachments for task
    const attachments = await fileQueries.getAttachmentsForTask(db, taskId);
    
    res.json(attachments);
  } catch (error) {
    console.error('Error fetching task attachments:', error);
    res.status(500).json({ error: 'Failed to fetch task attachments' });
  }
});

router.post('/:taskId/attachments', authenticateToken, async (req, res) => {
  const { taskId } = req.params;
  const parsed = parseBody(taskAttachmentsBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { attachments } = parsed.data;
  const userId = req.user.id;
  const db = getRequestDatabase(req);
  
  try {
    const insertedAttachments = [];
    
    if (attachments?.length > 0) {
      const addBytes = attachments.reduce((sum, a) => sum + (Number(a.size) || 0), 0);
      const licenseManager = getLicenseManager(db);
      if (licenseManager.isEnabled()) {
        try {
          await licenseManager.checkStorageLimit(addBytes);
        } catch (limitErr) {
          return res.status(403).json({
            error: 'License limit exceeded',
            details: limitErr.message,
            limit: 'STORAGE_LIMIT'
          });
        }
      }

      // Collect queries and send as a batched transaction
      const batchQueries = [];
      const insertQuery = `
        INSERT INTO attachments (id, taskid, name, url, type, size)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      for (const attachment of attachments) {
        batchQueries.push({
          query: insertQuery,
          params: [
            attachment.id,
            taskId,
            attachment.name,
            attachment.url,
            attachment.type,
            attachment.size
          ]
        });
        insertedAttachments.push(attachment);
      }
      
      // Execute all inserts in a single batched transaction
      await db.executeBatchTransaction(batchQueries);

    }
    
    // Update storage usage after adding attachments
    if (insertedAttachments.length > 0) {
      await updateStorageUsage(db);
    }
    
    // MIGRATED: Get the task's board ID using sqlManager
    const task = await fileQueries.getTaskByIdForFiles(db, taskId);
    
    // Publish to Redis for real-time updates
    if (task?.boardId && insertedAttachments.length > 0) {
        // MIGRATED: Fetch complete task with all relationships using sqlManager
        const taskWithRelationships = await taskQueries.getTaskWithRelationships(db, taskId);
        
        if (taskWithRelationships) {
          // MIGRATED: Get attachments for all comments using sqlManager
          if (taskWithRelationships.comments && taskWithRelationships.comments.length > 0) {
            const commentIds = taskWithRelationships.comments.map(c => c.id).filter(Boolean);
            if (commentIds.length > 0) {
              const allAttachments = await fileQueries.getAttachmentsForComments(db, commentIds);
              
              // Group attachments by commentid
              const attachmentsByCommentId = new Map();
              allAttachments.forEach(att => {
                const commentId = att.commentId;
                if (!attachmentsByCommentId.has(commentId)) {
                  attachmentsByCommentId.set(commentId, []);
                }
                attachmentsByCommentId.get(commentId).push(att);
              });
              
              // Assign attachments to each comment
              taskWithRelationships.comments.forEach(comment => {
                comment.attachments = attachmentsByCommentId.get(comment.id) || [];
              });
            }
          }
          
          // Convert snake_case to camelCase (if needed)
          const taskResponse = {
            ...taskWithRelationships,
            boardId: taskWithRelationships.boardid || taskWithRelationships.boardId,
            columnId: taskWithRelationships.columnid || taskWithRelationships.columnId,
            sprintId: taskWithRelationships.sprint_id || taskWithRelationships.sprintId || null,
            createdAt: taskWithRelationships.created_at || taskWithRelationships.createdAt,
            updatedAt: taskWithRelationships.updated_at || taskWithRelationships.updatedAt
          };
          
          // Publish task-updated event with complete task data (includes updated attachmentCount)
          const tenantId = getTenantId(req);
          await notificationService.publish('task-updated', {
            boardId: task.boardId,
            task: {
              ...taskResponse,
              updatedBy: userId
            },
            timestamp: new Date().toISOString()
          }, tenantId);
        }
        
        // Also publish task-attachments-added for any handlers that might need it
        const tenantId = getTenantId(req);
        console.log('📤 Publishing task-attachments-added to Redis for board:', task.boardId);
        await notificationService.publish('task-attachments-added', {
          boardId: task.boardId,
          taskId: taskId,
          attachments: insertedAttachments,
          timestamp: new Date().toISOString()
        }, tenantId);
        console.log('✅ Task-attachments-added published to Redis');
      }
    
    res.json({ 
      message: 'Attachments added successfully',
      attachments: insertedAttachments
    });
  } catch (error) {
    console.error('Error adding attachments to task:', error);
    res.status(500).json({ error: 'Failed to add attachments to task' });
  }
});

// Note: Attachment deletion is handled by /api/attachments/:id in routes/files.js
// This endpoint was removed to avoid duplication

export default router;

