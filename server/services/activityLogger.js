import { isValidAction, MEMBER_ACTIONS } from '../constants/activityActions.js';
import notificationService from './notificationService.js';
import { notifyTaskActivity, notifyCommentActivity, notifyBulkTaskFieldActivity } from './taskEmailNotificationService.js';
import { getBilingualTranslation, t } from '../utils/i18n.js';
import { activity as activityQueries, helpers } from '../utils/sqlManager/index.js';

/**
 * Activity Logger Service
 * Handles logging of user activities in the system
 */

let db; // Database instance will be injected

/**
 * Initialize the activity logger with database instance
 */
export const initActivityLogger = (database) => {
  db = database;
};

/** Whether this activity came from a personal API token (ek_…). */
function resolveViaApi(additionalData = {}) {
  return Boolean(
    additionalData.viaApi === true ||
      additionalData.authType === 'pat'
  );
}

/** Persist bilingual details + optional viaApi flag in activity.details JSON. */
function stringifyActivityDetails(bilingual, additionalData = {}) {
  const payload = { ...bilingual };
  if (resolveViaApi(additionalData)) {
    payload.viaApi = true;
  }
  return JSON.stringify(payload);
}

/**
 * Log a task-related activity with automatic role detection
 * @param {string} userId - User ID
 * @param {string} action - Action constant
 * @param {string} taskId - Task ID
 * @param {string} details - Description of the change
 * @param {Object} [additionalData] - Additional data (columnId, boardId, tenantId, db, etc.)
 * @param {Database} [additionalData.db] - Database instance (for multi-tenant mode, falls back to global db)
 */
export const logTaskActivity = async (userId, action, taskId, details, additionalData = {}) => {
  // Use database from additionalData if provided (multi-tenant mode), otherwise use global db
  const database = additionalData.db || db;
  
  if (!database) {
    console.warn('Activity logger: No database available, skipping log');
    return;
  }

  if (!userId || !action || !taskId || !details) {
    console.warn('Missing required parameters for activity logging');
    return;
  }

  if (!isValidAction(action)) {
    console.warn(`Warning: Unknown action "${action}" being logged`);
  }

  try {
    // Get task and board information for context
    let taskTitle = 'Unknown Task';
    let boardId = null;
    let boardTitle = 'Unknown Board';
    let columnId = null;

    try {
      // MIGRATED: Use SQL Manager
      const taskInfo = await activityQueries.getTaskInfoForActivity(database, taskId);
      
      if (taskInfo) {
        taskTitle = taskInfo.title || 'Unknown Task';
        boardId = taskInfo.boardId;
        boardTitle = taskInfo.boardTitle || 'Unknown Board';
        columnId = taskInfo.columnId;
      }
    } catch (taskError) {
      console.warn('Failed to get task/board info for task activity:', taskError.message);
    }

    // MIGRATED: Use SQL Manager
    const userRole = await activityQueries.getUserRoleForActivity(database, userId);
    const fallbackRole = await activityQueries.getFallbackRole(database);
    const roleId = userRole?.roleId || fallbackRole?.id || null;

    // MIGRATED: Use SQL Manager
    const userExists = await activityQueries.checkUserExists(database, userId);

    if (!userExists || !roleId) {
      console.warn(`Skipping activity log: User ${userId} or role ${roleId} not found in database`);
      return;
    }

    // Get project identifier and task ticket for enhanced context
    // Use values from additionalData if provided (e.g., for deleted tasks), otherwise fetch from database
    let projectIdentifier = additionalData.projectIdentifier || null;
    let taskTicket = additionalData.taskTicket || null;
    
    // Only fetch from database if not provided in additionalData (task might be deleted)
    if (!projectIdentifier || !taskTicket) {
      try {
        // MIGRATED: Use SQL Manager
        const taskDetails = await activityQueries.getTaskDetailsForActivity(database, taskId);
        
        if (taskDetails) {
          projectIdentifier = projectIdentifier || taskDetails.project;
          taskTicket = taskTicket || taskDetails.ticket;
        }
      } catch (prefixError) {
        // Task might be deleted (e.g., for delete_task action), use values from additionalData
        console.warn('Failed to get project/task identifiers from database (task may be deleted):', prefixError.message);
      }
    }

    // Get bilingual translations for task and board titles
    const unknownTaskEn = t('activity.unknownTask', {}, 'en');
    const unknownTaskFr = t('activity.unknownTask', {}, 'fr');
    const unknownBoardEn = t('activity.unknownBoard', {}, 'en');
    const unknownBoardFr = t('activity.unknownBoard', {}, 'fr');
    
    const translatedTaskTitle = {
      en: taskTitle === 'Unknown Task' ? unknownTaskEn : taskTitle,
      fr: taskTitle === 'Unknown Task' ? unknownTaskFr : taskTitle
    };
    const translatedBoardTitle = {
      en: boardTitle === 'Unknown Board' ? unknownBoardEn : boardTitle,
      fr: boardTitle === 'Unknown Board' ? unknownBoardFr : boardTitle
    };
    
    // Create enhanced details with context for specific actions (bilingual)
    let enhancedDetailsBilingual = { en: details, fr: details };
    const taskRef = taskTicket ? ` (${taskTicket})` : '';
    
    if (action === 'create_task') {
      // Check if details is already bilingual JSON (from route)
      let isBilingualJson = false;
      let parsedDetails = null;
      try {
        parsedDetails = JSON.parse(details);
        if (parsedDetails.en && parsedDetails.fr) {
          isBilingualJson = true;
          // Check if it's a "create at top" message
          if (parsedDetails.en.includes('at top of column') || parsedDetails.fr.includes('en haut de la colonne')) {
            // Already complete bilingual message with boardTitle, use as-is
            // Project/task reference will be appended at the end (after this block)
            enhancedDetailsBilingual = parsedDetails;
          } else {
            // Regular create, but already bilingual - use as-is
            // Project/task reference will be appended at the end (after this block)
            enhancedDetailsBilingual = parsedDetails;
          }
        }
      } catch {
        // Not JSON, continue with string check
      }
      
      // If not already bilingual JSON, check if this is a "create at top" action
      if (!isBilingualJson && details && details.includes('at top')) {
        enhancedDetailsBilingual = getBilingualTranslation('activity.createdTaskAtTop', {
          taskTitle: translatedTaskTitle.en, // Use English title for both (task titles are not translated)
          boardTitle: translatedBoardTitle.en
        });
        // Override with actual task title and board title (same for both languages)
        enhancedDetailsBilingual.en = t('activity.createdTaskAtTop', { taskTitle: translatedTaskTitle.en, boardTitle: translatedBoardTitle.en }, 'en');
        enhancedDetailsBilingual.fr = t('activity.createdTaskAtTop', { taskTitle: translatedTaskTitle.fr, boardTitle: translatedBoardTitle.fr }, 'fr');
        // Note: taskRef will be appended at the end, so don't include it in the translation
      } else if (!isBilingualJson) {
        // For regular create, taskRef is included in the translation template
        enhancedDetailsBilingual.en = t('activity.createdTask', {
          taskTitle: translatedTaskTitle.en,
          taskRef: '', // Will be appended at the end instead
          boardTitle: translatedBoardTitle.en
        }, 'en');
        enhancedDetailsBilingual.fr = t('activity.createdTask', {
          taskTitle: translatedTaskTitle.fr,
          taskRef: '', // Will be appended at the end instead
          boardTitle: translatedBoardTitle.fr
        }, 'fr');
      }
    } else if (
      action === 'delete_task' ||
      action === 'restore_task' ||
      action === 'copy_task' ||
      action === 'associate_tag' ||
      action === 'disassociate_tag'
    ) {
      // Check if details is already bilingual JSON (from route)
      let isBilingualJson = false;
      try {
        const parsed = JSON.parse(details);
        if (parsed.en && parsed.fr) {
          isBilingualJson = true;
          enhancedDetailsBilingual = parsed;
        }
      } catch {
        // Not JSON, continue with string check
      }
      
      // If not already bilingual JSON, create bilingual messages
      if (!isBilingualJson) {
        if (action === 'copy_task') {
          enhancedDetailsBilingual.en = t('activity.copiedTask', {
            taskTitle: translatedTaskTitle.en,
            boardTitle: translatedBoardTitle.en
          }, 'en');
          enhancedDetailsBilingual.fr = t('activity.copiedTask', {
            taskTitle: translatedTaskTitle.fr,
            boardTitle: translatedBoardTitle.fr
          }, 'fr');
        } else if (action === 'associate_tag' || action === 'disassociate_tag') {
          enhancedDetailsBilingual = { en: details, fr: details };
        } else {
          const key = action === 'restore_task' ? 'activity.restoredTask' : 'activity.deletedTask';
          // For delete_task, if taskTitle is "Unknown Task", use the provided details
          if (
            action === 'delete_task' &&
            taskTitle === 'Unknown Task' &&
            details.includes('deleted task')
          ) {
            enhancedDetailsBilingual = { en: details, fr: details };
          } else {
            enhancedDetailsBilingual.en = t(key, {
              taskTitle: translatedTaskTitle.en,
              taskRef,
              boardTitle: translatedBoardTitle.en
            }, 'en');
            enhancedDetailsBilingual.fr = t(key, {
              taskTitle: translatedTaskTitle.fr,
              taskRef,
              boardTitle: translatedBoardTitle.fr
            }, 'fr');
          }
        }
      }
    } else if (action === 'move_task') {
      // Board move already includes task name, add task reference if available
      // Details might already be bilingual JSON, so we need to handle both cases
      let detailsEn = details;
      let detailsFr = details;
      try {
        const parsed = JSON.parse(details);
        if (parsed.en && parsed.fr) {
          detailsEn = parsed.en;
          detailsFr = parsed.fr;
        }
      } catch {
        // Not JSON, use as-is
      }
      
      enhancedDetailsBilingual.en = t('activity.movedTask', {
        details: detailsEn,
        taskRef,
        boardTitle: translatedBoardTitle.en
      }, 'en');
      enhancedDetailsBilingual.fr = t('activity.movedTask', {
        details: detailsFr,
        taskRef,
        boardTitle: translatedBoardTitle.fr
      }, 'fr');
    } else if (action === 'update_task') {
      // Check if details is already a complete bilingual JSON message
      let detailsEn = details;
      let detailsFr = details;
      let isCompleteMessage = false;
      
      try {
        const parsed = JSON.parse(details);
        if (parsed.en && parsed.fr) {
          // Check if this is already a complete message (contains task title/board context)
          // Complete messages typically contain "in task" or "dans la tâche" or "in board" or "dans le tableau"
          const isCompleteEn = parsed.en.includes('in task') || parsed.en.includes('in board') || parsed.en.includes('updated task:');
          const isCompleteFr = parsed.fr.includes('dans la tâche') || parsed.fr.includes('dans le tableau') || parsed.fr.includes('a modifié la tâche:');
          
          if (isCompleteEn || isCompleteFr) {
            // Already a complete message, use as-is
            enhancedDetailsBilingual = parsed;
            isCompleteMessage = true;
          } else {
            // Partial message, needs wrapping
            detailsEn = parsed.en;
            detailsFr = parsed.fr;
          }
        }
      } catch {
        // Not JSON, check if it's a complete plain text message
        if (details.includes('in task') || details.includes('in board') || details.includes('updated task:') || 
            details.includes('dans la tâche') || details.includes('dans le tableau') || details.includes('a modifié la tâche:')) {
          // Complete message in old format, convert to bilingual
          enhancedDetailsBilingual = { en: details, fr: details };
          isCompleteMessage = true;
        }
        // Otherwise use as-is for wrapping
      }
      
      if (!isCompleteMessage) {
        // Wrap partial details in activity template
        if (detailsEn.includes('moved task') && detailsEn.includes('from') && detailsEn.includes('to')) {
          // Column move already includes task reference, just add board context
          enhancedDetailsBilingual.en = t('activity.movedTaskColumn', {
            details: detailsEn,
            boardTitle: translatedBoardTitle.en
          }, 'en');
          enhancedDetailsBilingual.fr = t('activity.movedTaskColumn', {
            details: detailsFr,
            boardTitle: translatedBoardTitle.fr
          }, 'fr');
        } else {
          enhancedDetailsBilingual.en = t('activity.updatedTask', {
            details: detailsEn,
            taskTitle: translatedTaskTitle.en,
            taskRef,
            boardTitle: translatedBoardTitle.en
          }, 'en');
          enhancedDetailsBilingual.fr = t('activity.updatedTask', {
            details: detailsFr,
            taskTitle: translatedTaskTitle.fr,
            taskRef,
            boardTitle: translatedBoardTitle.fr
          }, 'fr');
        }
      }
    } else if (action === 'agent_job_done') {
      const prUrl = additionalData.prUrl ? String(additionalData.prUrl) : '';
      enhancedDetailsBilingual = {
        en: t(
          prUrl ? 'activity.agentJobDoneWithPr' : 'activity.agentJobDone',
          {
            taskTitle: translatedTaskTitle.en,
            taskRef,
            boardTitle: translatedBoardTitle.en,
            prUrl
          },
          'en'
        ),
        fr: t(
          prUrl ? 'activity.agentJobDoneWithPr' : 'activity.agentJobDone',
          {
            taskTitle: translatedTaskTitle.fr,
            taskRef,
            boardTitle: translatedBoardTitle.fr,
            prUrl
          },
          'fr'
        )
      };
    } else if (action === 'agent_job_failed') {
      enhancedDetailsBilingual = {
        en: t(
          'activity.agentJobFailed',
          {
            taskTitle: translatedTaskTitle.en,
            taskRef,
            boardTitle: translatedBoardTitle.en
          },
          'en'
        ),
        fr: t(
          'activity.agentJobFailed',
          {
            taskTitle: translatedTaskTitle.fr,
            taskRef,
            boardTitle: translatedBoardTitle.fr
          },
          'fr'
        )
      };
    }

    // Append project identifier after the board mention (task ticket already appears via taskRef)
    // e.g. ... in board "Security" (PROJ-00008) — not (PROJ-00008/TASK-00383)
    if (projectIdentifier) {
      const suffix = ` (${projectIdentifier})`;
      // Strip prior trailing (PROJ…), (PROJ…/TASK…), or similar identifier suffixes
      const refPattern = /\s*\([A-Za-z]+-\d+(?:\/[A-Za-z]+-\d+)?\)\s*$/;
      enhancedDetailsBilingual.en = enhancedDetailsBilingual.en.replace(refPattern, '') + suffix;
      enhancedDetailsBilingual.fr = enhancedDetailsBilingual.fr.replace(refPattern, '') + suffix;
    }
    
    // Convert to JSON string for storage
    const enhancedDetails = stringifyActivityDetails(
      enhancedDetailsBilingual,
      additionalData
    );

    // MIGRATED: Use SQL Manager to insert activity
    await activityQueries.insertActivity(database, {
      userId,
      roleId,
      action,
      taskId,
      columnId: columnId || additionalData.columnId || null,
      boardId: boardId || additionalData.boardId || null,
      tagId: additionalData.tagId || null,
      details: enhancedDetails
    });

    // Publish activity update for real-time updates
    // Note: For PostgreSQL, we send minimal payload (timestamp) to avoid 8000 byte limit
    // Clients should fetch full activity feed from API when they receive this notification
    try {
      // Get tenantId from additionalData if provided (for multi-tenant isolation)
      const tenantId = additionalData.tenantId || null;
      
      // Send minimal notification - clients will fetch full feed from API
      // This avoids PostgreSQL's 8000 byte payload limit
      await notificationService.publish('activity-updated', {
        timestamp: new Date().toISOString(),
        message: 'Activity feed updated'
      }, tenantId);
    } catch (error) {
      console.warn('Failed to publish activity update:', error.message);
    }
    
    // Task activity emails (fire-and-forget; mail gate inside orchestrator)
    if (!additionalData.skipEmail) {
      const emailDb = additionalData.db || database;
      const emailTenantId = additionalData.tenantId || null;
      notifyTaskActivity(
        emailDb,
        {
          userId,
          action,
          taskId,
          details: enhancedDetails,
          oldValue: additionalData.oldValue,
          newValue: additionalData.newValue,
          changedField: additionalData.changedField || null,
          projectIdentifier: additionalData.projectIdentifier || projectIdentifier || null,
          taskTicket: additionalData.taskTicket || taskTicket || null,
          tagId: additionalData.tagId || null,
          emailChange: additionalData.emailChange || null,
        },
        emailTenantId
      ).catch((notificationError) => {
        console.error('❌ Error sending task notification email:', notificationError);
      });
    }
    
  } catch (error) {
    console.error('❌ Error logging activity:', error);
    // Don't throw - activity logging should never break the main functionality
  }
};

/**
 * Log a general activity (non-task specific)
 * @param {string} userId - User ID
 * @param {string} action - Action constant
 * @param {string} details - Description of the change
 * @param {Object} [additionalData] - Additional data (columnId, boardId, tagId, etc.)
 */
export const logActivity = async (userId, action, details, additionalData = {}) => {
  // Use database from additionalData if provided (multi-tenant mode), otherwise use global db
  const database = additionalData.db || db;
  
  if (!database) {
    console.warn('Activity logger: No database available, skipping log');
    return;
  }

  if (!userId || !action || !details) {
    console.warn('Missing required parameters for activity logging');
    return;
  }

  if (!isValidAction(action)) {
    console.warn(`Warning: Unknown action "${action}" being logged`);
  }

  try {
    // MIGRATED: Use SQL Manager
    const userRole = await activityQueries.getUserRoleForActivity(database, userId);
    const fallbackRole = await activityQueries.getFallbackRole(database);
    const roleId = userRole?.roleId || fallbackRole?.id || null;

    // MIGRATED: Use SQL Manager
    const userExists = await activityQueries.checkUserExists(database, userId);

    if (!userExists || !roleId) {
      console.warn(`Skipping activity log: User ${userId} or role ${roleId} not found in database`);
      return;
    }

    // Handle details - if it's already JSON, use it; otherwise create bilingual version
    let translatedDetails = details;
    try {
      const parsed = JSON.parse(details);
      if (parsed.en && parsed.fr) {
        // Already bilingual JSON, use as-is
        translatedDetails = details;
      } else {
        // Not valid bilingual JSON, create it
        translatedDetails = JSON.stringify({ en: details, fr: details });
      }
    } catch {
      // Not JSON, create bilingual version (same text for both languages)
      translatedDetails = JSON.stringify({ en: details, fr: details });
    }

    // MIGRATED: Use SQL Manager to insert activity
    await activityQueries.insertActivity(database, {
      userId,
      roleId,
      action,
      taskId: additionalData.taskId || null,
      columnId: additionalData.columnId || null,
      boardId: additionalData.boardId || null,
      tagId: additionalData.tagId || null,
      details: translatedDetails
    });

    // Publish activity update for real-time updates
    // Note: For PostgreSQL, we send minimal payload (timestamp) to avoid 8000 byte limit
    // Clients should fetch full activity feed from API when they receive this notification
    try {
      // Get tenantId from additionalData if provided (for multi-tenant isolation)
      const tenantId = additionalData.tenantId || null;
      
      // Send minimal notification - clients will fetch full feed from API
      // This avoids PostgreSQL's 8000 byte payload limit
      await notificationService.publish('activity-updated', {
        timestamp: new Date().toISOString(),
        message: 'Activity feed updated'
      }, tenantId);
    } catch (error) {
      console.warn('Failed to publish activity update:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Error logging activity:', error);
    // Don't throw - activity logging should never break the main functionality
  }
};

/**
 * Helper function to generate detailed descriptions for common task changes
 */
/**
 * Analyze HTML content to extract images and text content
 */
const analyzeHTMLContent = (html) => {
  if (!html) return { text: '', images: [] };
  
  // Extract images (look for img tags with src)
  const imageRegex = /<img[^>]*src="([^"]*)"[^>]*>/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(html)) !== null) {
    images.push(match[1]); // src URL
  }
  
  // Extract text content (remove HTML tags)
  const textContent = html
    .replace(/<img[^>]*>/g, '') // Remove img tags
    .replace(/<[^>]*>/g, '') // Remove all other HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  return { text: textContent, images };
};

/**
 * Generate intelligent description change details (bilingual)
 */
const generateDescriptionChangeDetails = (oldValue, newValue) => {

  const oldContent = analyzeHTMLContent(oldValue);
  const newContent = analyzeHTMLContent(newValue);
  
  const textChanged = oldContent.text !== newContent.text;
  const imagesAdded = newContent.images.filter(img => !oldContent.images.includes(img));
  const imagesRemoved = oldContent.images.filter(img => !newContent.images.includes(img));
  
  const actionsEn = [];
  const actionsFr = [];
  
  // Check for text changes
  if (textChanged) {
    actionsEn.push(t('activity.updatedDescription', {}, 'en'));
    actionsFr.push(t('activity.updatedDescription', {}, 'fr'));
  }
  
  // Check for image changes
  if (imagesAdded.length > 0) {
    const count = imagesAdded.length;
    const keyEn = count === 1 ? 'activity.addedAttachment' : 'activity.addedAttachments';
    const keyFr = count === 1 ? 'activity.addedAttachment' : 'activity.addedAttachments';
    actionsEn.push(t(keyEn, { count }, 'en'));
    actionsFr.push(t(keyFr, { count }, 'fr'));
  }
  
  if (imagesRemoved.length > 0) {
    const count = imagesRemoved.length;
    const keyEn = count === 1 ? 'activity.removedAttachment' : 'activity.removedAttachments';
    const keyFr = count === 1 ? 'activity.removedAttachment' : 'activity.removedAttachments';
    actionsEn.push(t(keyEn, { count }, 'en'));
    actionsFr.push(t(keyFr, { count }, 'fr'));
  }
  
  // If no meaningful changes detected, fall back to generic message
  if (actionsEn.length === 0) {
    return JSON.stringify(getBilingualTranslation('activity.updatedDescription'));
  }
  
  // Join actions with " and " - same for both languages
  return JSON.stringify({
    en: actionsEn.join(' and '),
    fr: actionsFr.join(' et ')
  });
};

export const generateTaskUpdateDetails = async (field, oldValue, newValue, additionalContext = '', db = null) => {
  // Use provided db parameter, or fall back to global db
  const finalDb = db || (typeof additionalContext === 'object' && additionalContext?.db) || null;
  // If additionalContext is a string, use it as context; otherwise extract context from object
  const context = typeof additionalContext === 'string' ? additionalContext : (additionalContext?.context || '');
  
  if (!finalDb) {
    console.warn('Database not available for generateTaskUpdateDetails');
    return JSON.stringify({ en: '', fr: '' });
  }

  // Map field names to translation keys (handle legacy field names)
  const fieldKeyMap = {
    'priority': 'priorityId',
    'priorityId': 'priorityId'
  };
  const translationKey = fieldKeyMap[field] || field;
  
  // Get bilingual field labels
  const fieldLabelEn = t(`activity.fieldLabels.${translationKey}`, {}, 'en') || field;
  const fieldLabelFr = t(`activity.fieldLabels.${translationKey}`, {}, 'fr') || field;

  // Special handling for description changes
  if (field === 'description') {
    if (oldValue === null || oldValue === undefined || oldValue === '') {
      const addedEn = t('activity.addedDescription', {}, 'en');
      const addedFr = t('activity.addedDescription', {}, 'fr');
      const updatedEn = t('activity.updatedDescription', {}, 'en');
      const updatedFr = t('activity.updatedDescription', {}, 'fr');
      return JSON.stringify({
        en: newValue ? addedEn : updatedEn,
        fr: newValue ? addedFr : updatedFr
      });
    } else if (newValue === null || newValue === undefined || newValue === '') {
      return JSON.stringify(getBilingualTranslation('activity.clearedDescription'));
    } else {
      return generateDescriptionChangeDetails(oldValue, newValue);
    }
  }

  // Special handling for memberid and requesterid changes - resolve member IDs to member names
  if (field === 'memberId' || field === 'requesterId') {
    const getMemberName = async (memberId) => {
      if (!memberId || !finalDb) {
        return {
          en: t('activity.unassigned', {}, 'en'),
          fr: t('activity.unassigned', {}, 'fr')
        };
      }
      try {
        // MIGRATED: Use SQL Manager
        const member = await activityQueries.getMemberName(finalDb, memberId);
        return {
          en: member?.name || t('activity.unknownUser', {}, 'en'),
          fr: member?.name || t('activity.unknownUser', {}, 'fr')
        };
      } catch (error) {
        console.warn('Failed to resolve member name for member ID:', memberId, error.message);
        return {
          en: t('activity.unknownUser', {}, 'en'),
          fr: t('activity.unknownUser', {}, 'fr')
        };
      }
    };

    const oldName = await getMemberName(oldValue);
    const newName = await getMemberName(newValue);

    if (field === 'memberId') {
      if (oldValue === null || oldValue === undefined || oldValue === '') {
        return JSON.stringify({
          en: t('activity.setAssignee', { newName: newName.en }, 'en') + context,
          fr: t('activity.setAssignee', { newName: newName.fr }, 'fr') + context
        });
      } else if (newValue === null || newValue === undefined || newValue === '') {
        return JSON.stringify({
          en: t('activity.clearedAssignee', { oldName: oldName.en }, 'en') + context,
          fr: t('activity.clearedAssignee', { oldName: oldName.fr }, 'fr') + context
        });
      } else {
        return JSON.stringify({
          en: t('activity.changedAssignee', { oldName: oldName.en, newName: newName.en }, 'en') + context,
          fr: t('activity.changedAssignee', { oldName: oldName.fr, newName: newName.fr }, 'fr') + context
        });
      }
    } else if (field === 'requesterId') {
      if (oldValue === null || oldValue === undefined || oldValue === '') {
        return JSON.stringify({
          en: t('activity.setRequester', { newName: newName.en }, 'en') + context,
          fr: t('activity.setRequester', { newName: newName.fr }, 'fr') + context
        });
      } else if (newValue === null || newValue === undefined || newValue === '') {
        return JSON.stringify({
          en: t('activity.clearedRequester', { oldName: oldName.en }, 'en') + context,
          fr: t('activity.clearedRequester', { oldName: oldName.fr }, 'fr') + context
        });
      } else {
        return JSON.stringify({
          en: t('activity.changedRequester', { oldName: oldName.en, newName: newName.en }, 'en') + context,
          fr: t('activity.changedRequester', { oldName: oldName.fr, newName: newName.fr }, 'fr') + context
        });
      }
    }
  }

  // Special handling for blocked flag
  if (field === 'isBlocked') {
    const wasBlocked = oldValue === true || oldValue === 1 || oldValue === 'true';
    const nowBlocked = newValue === true || newValue === 1 || newValue === 'true';
    if (!wasBlocked && nowBlocked) {
      return JSON.stringify(getBilingualTranslation('activity.markedAsBlocked'));
    }
    if (wasBlocked && !nowBlocked) {
      return JSON.stringify(getBilingualTranslation('activity.clearedBlocked'));
    }
    return JSON.stringify({ en: '', fr: '' });
  }

  // Handle other fields as before
  if (oldValue === null || oldValue === undefined || oldValue === '') {
    return JSON.stringify({
      en: t('activity.setField', { fieldLabel: fieldLabelEn, newValue }, 'en') + context,
      fr: t('activity.setField', { fieldLabel: fieldLabelFr, newValue }, 'fr') + context
    });
  } else if (newValue === null || newValue === undefined || newValue === '') {
    return JSON.stringify({
      en: t('activity.clearedField', { fieldLabel: fieldLabelEn, oldValue }, 'en') + context,
      fr: t('activity.clearedField', { fieldLabel: fieldLabelFr, oldValue }, 'fr') + context
    });
  } else {
    return JSON.stringify({
      en: t('activity.changedField', { fieldLabel: fieldLabelEn, oldValue, newValue }, 'en') + context,
      fr: t('activity.changedField', { fieldLabel: fieldLabelFr, oldValue, newValue }, 'fr') + context
    });
  }
};

/**
 * Log a comment-related activity
 * @param {string} userId - User ID
 * @param {string} action - Action constant from COMMENT_ACTIONS
 * @param {string} commentId - Comment ID (TEXT/UUID)
 * @param {string} taskId - Task ID that the comment belongs to
 * @param {string} details - Description of the change
 * @param {Object} [additionalData] - Additional data (boardId, columnId, etc.)
 */
export const logCommentActivity = async (userId, action, commentId, taskId, details, additionalData = {}) => {
  // Use database from additionalData if provided (multi-tenant mode), otherwise use global db
  const database = additionalData.db || db;
  
  if (!database) {
    console.warn('Activity logger: No database available, skipping comment log');
    return;
  }

  if (!isValidAction(action)) {
    console.warn(`Unknown comment action "${action}" being logged`);
  }

  try {
    // Get task and board information for context
    let taskTitle = 'Unknown Task';
    let boardId = null;
    let boardTitle = 'Unknown Board';
    let columnId = null;

    try {
      // MIGRATED: Use SQL Manager
      const taskInfo = await activityQueries.getTaskInfoForActivity(database, taskId);
      
      if (taskInfo) {
        taskTitle = taskInfo.title || 'Unknown Task';
        boardId = taskInfo.boardId;
        boardTitle = taskInfo.boardTitle || 'Unknown Board';
        columnId = taskInfo.columnId;
      }
    } catch (taskError) {
      console.warn('Failed to get task/board info for comment activity:', taskError.message);
    }

    // MIGRATED: Use SQL Manager
    const userRole = await activityQueries.getUserRoleForActivity(database, userId);
    const fallbackRole = await activityQueries.getFallbackRole(database);
    const finalRoleId = userRole?.roleId || fallbackRole?.id || null;

    // MIGRATED: Use SQL Manager
    const userExists = await activityQueries.checkUserExists(database, userId);
    if (!userExists) {
      console.warn(`User ${userId} not found for comment activity logging`);
    }

    // Get bilingual translations for task and board titles
    const unknownTaskEn = t('activity.unknownTask', {}, 'en');
    const unknownTaskFr = t('activity.unknownTask', {}, 'fr');
    const unknownBoardEn = t('activity.unknownBoard', {}, 'en');
    const unknownBoardFr = t('activity.unknownBoard', {}, 'fr');
    
    const translatedTaskTitle = {
      en: taskTitle === 'Unknown Task' ? unknownTaskEn : taskTitle,
      fr: taskTitle === 'Unknown Task' ? unknownTaskFr : taskTitle
    };
    const translatedBoardTitle = {
      en: boardTitle === 'Unknown Board' ? unknownBoardEn : boardTitle,
      fr: boardTitle === 'Unknown Board' ? unknownBoardFr : boardTitle
    };
    
    // Get task reference for enhanced context
    let taskRef = '';
    try {
      // MIGRATED: Use SQL Manager
      const taskDetails = await activityQueries.getTaskTicket(database, taskId);
      if (taskDetails?.ticket) {
        taskRef = ` (${taskDetails.ticket})`;
      }
    } catch (refError) {
      console.warn('Failed to get task reference for comment activity:', refError.message);
    }
    
    // Create clean, user-friendly details without exposing raw comment content (bilingual)
    let enhancedDetailsBilingual;
    if (action === 'create_comment') {
      enhancedDetailsBilingual = {
        en: t('activity.addedComment', {
          taskTitle: translatedTaskTitle.en,
          taskRef,
          boardTitle: translatedBoardTitle.en
        }, 'en'),
        fr: t('activity.addedComment', {
          taskTitle: translatedTaskTitle.fr,
          taskRef,
          boardTitle: translatedBoardTitle.fr
        }, 'fr')
      };
    } else if (action === 'update_comment') {
      enhancedDetailsBilingual = {
        en: t('activity.updatedComment', {
          taskTitle: translatedTaskTitle.en,
          taskRef,
          boardTitle: translatedBoardTitle.en
        }, 'en'),
        fr: t('activity.updatedComment', {
          taskTitle: translatedTaskTitle.fr,
          taskRef,
          boardTitle: translatedBoardTitle.fr
        }, 'fr')
      };
    } else if (action === 'delete_comment') {
      enhancedDetailsBilingual = {
        en: t('activity.deletedComment', {
          taskTitle: translatedTaskTitle.en,
          taskRef,
          boardTitle: translatedBoardTitle.en
        }, 'en'),
        fr: t('activity.deletedComment', {
          taskTitle: translatedTaskTitle.fr,
          taskRef,
          boardTitle: translatedBoardTitle.fr
        }, 'fr')
      };
    } else {
      enhancedDetailsBilingual = {
        en: t('activity.updatedComment', {
          taskTitle: translatedTaskTitle.en,
          taskRef,
          boardTitle: translatedBoardTitle.en
        }, 'en'),
        fr: t('activity.updatedComment', {
          taskTitle: translatedTaskTitle.fr,
          taskRef,
          boardTitle: translatedBoardTitle.fr
        }, 'fr')
      };
    }

    // Get project identifier and task ticket for enhanced context (always enabled)
    try {
      // MIGRATED: Use SQL Manager
      const taskDetails = await activityQueries.getTaskDetailsForActivity(database, taskId);
      
      if (taskDetails?.project) {
        // Board context → project id only (task ticket already in taskRef)
        const suffix = ` (${taskDetails.project})`;
        enhancedDetailsBilingual.en += suffix;
        enhancedDetailsBilingual.fr += suffix;
      }
    } catch (prefixError) {
      console.warn('Failed to get project/task identifiers for comment activity:', prefixError.message);
    }

    // Convert to JSON string for storage
    const enhancedDetails = stringifyActivityDetails(
      enhancedDetailsBilingual,
      additionalData
    );

    // MIGRATED: Use SQL Manager to insert activity
    await activityQueries.insertActivity(database, {
      userId,
      roleId: finalRoleId,
      action,
      taskId,
      commentId,
      columnId: columnId || additionalData.columnId || null,
      boardId: boardId || additionalData.boardId || null,
      tagId: additionalData.tagId || null,
      details: enhancedDetails
    });

    console.log('Comment activity logged successfully');
    
    // Publish activity update for real-time updates
    // Note: For PostgreSQL, we send minimal payload (timestamp) to avoid 8000 byte limit
    // Clients should fetch full activity feed from API when they receive this notification
    try {
      // Get tenantId from additionalData if provided (for multi-tenant isolation)
      const tenantId = additionalData.tenantId || null;
      
      // Send minimal notification - clients will fetch full feed from API
      // This avoids PostgreSQL's 8000 byte payload limit
      await notificationService.publish('activity-updated', {
        timestamp: new Date().toISOString(),
        message: 'Activity feed updated'
      }, tenantId);
    } catch (error) {
      console.warn('Failed to publish comment activity update:', error.message);
    }
    
    // Comment emails (fire-and-forget; mail gate inside orchestrator)
    const emailDb = additionalData.db || database;
    const emailTenantId = additionalData.tenantId || null;
    notifyCommentActivity(
      emailDb,
      {
        userId,
        action,
        taskId,
        commentContent: additionalData.commentContent,
      },
      emailTenantId
    ).catch((notificationError) => {
      console.error('❌ Error sending comment notification email:', notificationError);
    });
    
  } catch (error) {
    console.error('Failed to log comment activity:', error);
  }
};

/**
 * Log a single activity feed entry for a multi-select / bulk field change.
 * @param {string} userId
 * @param {'memberId'|'requesterId'|'priorityId'|'sprintId'} field
 * @param {Object} payload
 * @param {string[]} payload.taskIds - Tasks that actually changed
 * @param {string|null} [payload.oldValue] - Shared previous value, or null if mixed/unknown
 * @param {string|null} payload.newValue
 * @param {string} [payload.newLabel] - Display label for priority/sprint
 * @param {string} [payload.boardId]
 * @param {Object} [additionalData] - db, tenantId, authType
 */
export const logBulkTaskFieldActivity = async (userId, field, payload = {}, additionalData = {}) => {
  const database = additionalData.db || db;
  if (!database) {
    console.warn('Activity logger: No database available, skipping bulk log');
    return;
  }

  const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter(Boolean) : [];
  const count = taskIds.length;
  if (!userId || !field || count === 0) {
    console.warn('Missing required parameters for bulk activity logging');
    return;
  }

  try {
    let boardId = payload.boardId || null;
    let boardTitle = 'Unknown Board';
    let projectIdentifier = null;

    const contextTaskId = taskIds[0];
    try {
      const taskInfo = await activityQueries.getTaskInfoForActivity(database, contextTaskId);
      if (taskInfo) {
        boardId = boardId || taskInfo.boardId;
        boardTitle = taskInfo.boardTitle || boardTitle;
      }
      const taskDetails = await activityQueries.getTaskDetailsForActivity(database, contextTaskId);
      if (taskDetails) {
        projectIdentifier = taskDetails.project || null;
        if (!boardTitle || boardTitle === 'Unknown Board') {
          // board title already from taskInfo
        }
      }
    } catch (err) {
      console.warn('Failed to resolve board context for bulk activity:', err.message);
    }

    const resolveMemberName = async (memberId) => {
      if (!memberId) {
        return {
          en: t('activity.unassigned', {}, 'en'),
          fr: t('activity.unassigned', {}, 'fr'),
        };
      }
      try {
        const member = await activityQueries.getMemberName(database, memberId);
        return {
          en: member?.name || t('activity.unknownUser', {}, 'en'),
          fr: member?.name || t('activity.unknownUser', {}, 'fr'),
        };
      } catch {
        return {
          en: t('activity.unknownUser', {}, 'en'),
          fr: t('activity.unknownUser', {}, 'fr'),
        };
      }
    };

    const boardTitleEn = boardTitle === 'Unknown Board' ? t('activity.unknownBoard', {}, 'en') : boardTitle;
    const boardTitleFr = boardTitle === 'Unknown Board' ? t('activity.unknownBoard', {}, 'fr') : boardTitle;

    let detailsEn = '';
    let detailsFr = '';

    if (payload.restoredPrevious === true && field !== 'columnId') {
      const keyByField = {
        memberId: 'activity.bulkRestoredPreviousAssignee',
        requesterId: 'activity.bulkRestoredPreviousRequester',
        priorityId: 'activity.bulkRestoredPreviousPriority',
        sprintId: 'activity.bulkRestoredPreviousSprint',
      };
      const key = keyByField[field];
      if (!key) {
        console.warn(`Unsupported restoredPrevious bulk field: ${field}`);
        return;
      }
      detailsEn = t(key, { count, boardTitle: boardTitleEn }, 'en');
      detailsFr = t(key, { count, boardTitle: boardTitleFr }, 'fr');
    } else if (field === 'columnId') {
      const reason = payload.reason || 'undidMove';
      const keyByReason = {
        archive: 'activity.bulkArchived',
        move: 'activity.bulkMovedColumn',
        undidArchive: 'activity.bulkUndidArchive',
        undidMove: 'activity.bulkUndidColumnMove',
      };
      const key = keyByReason[reason] || keyByReason.undidMove;
      detailsEn = t(key, { count, boardTitle: boardTitleEn }, 'en');
      detailsFr = t(key, { count, boardTitle: boardTitleFr }, 'fr');
    } else if (field === 'delete') {
      detailsEn = t('activity.bulkDeleted', { count, boardTitle: boardTitleEn }, 'en');
      detailsFr = t('activity.bulkDeleted', { count, boardTitle: boardTitleFr }, 'fr');
    } else if (field === 'moveBoard') {
      let toBoard = payload.newLabel || '';
      if (!toBoard && payload.newValue) {
        try {
          const { boards: boardQueries } = await import('../utils/sqlManager/index.js');
          const board = await boardQueries.getBoardById(database, payload.newValue);
          toBoard = board?.title || String(payload.newValue);
        } catch {
          toBoard = String(payload.newValue);
        }
      }
      detailsEn = t('activity.bulkMovedBoard', {
        count,
        boardTitle: boardTitleEn,
        toBoard: toBoard || payload.newValue || '',
      }, 'en');
      detailsFr = t('activity.bulkMovedBoard', {
        count,
        boardTitle: boardTitleFr,
        toBoard: toBoard || payload.newValue || '',
      }, 'fr');
    } else if (field === 'collaborator') {
      const newName = await resolveMemberName(payload.newValue);
      detailsEn = t('activity.bulkAddedCollaborator', {
        newName: newName.en,
        count,
        boardTitle: boardTitleEn,
      }, 'en');
      detailsFr = t('activity.bulkAddedCollaborator', {
        newName: newName.fr,
        count,
        boardTitle: boardTitleFr,
      }, 'fr');
    } else if (field === 'watcher') {
      const newName = await resolveMemberName(payload.newValue);
      detailsEn = t('activity.bulkAddedWatcher', {
        newName: newName.en,
        count,
        boardTitle: boardTitleEn,
      }, 'en');
      detailsFr = t('activity.bulkAddedWatcher', {
        newName: newName.fr,
        count,
        boardTitle: boardTitleFr,
      }, 'fr');
    } else if (field === 'tag') {
      let tagLabel = payload.newLabel || '';
      if (!tagLabel && payload.newValue != null && payload.newValue !== '') {
        try {
          const tag = await helpers.getTagById(database, parseInt(String(payload.newValue), 10));
          tagLabel = tag?.tag || String(payload.newValue);
        } catch {
          tagLabel = String(payload.newValue);
        }
      }
      detailsEn = t('activity.bulkAddedTag', {
        tagName: tagLabel,
        count,
        boardTitle: boardTitleEn,
      }, 'en');
      detailsFr = t('activity.bulkAddedTag', {
        tagName: tagLabel,
        count,
        boardTitle: boardTitleFr,
      }, 'fr');
    } else if (field === 'copy') {
      detailsEn = t('activity.bulkCopied', { count, boardTitle: boardTitleEn }, 'en');
      detailsFr = t('activity.bulkCopied', { count, boardTitle: boardTitleFr }, 'fr');
    } else if (field === 'memberId' || field === 'requesterId') {
      const newName = await resolveMemberName(payload.newValue);
      const hasSharedOld =
        payload.oldValue !== undefined &&
        payload.oldValue !== null &&
        payload.oldValue !== '';
      const oldName = hasSharedOld ? await resolveMemberName(payload.oldValue) : null;
      const keyBase = field === 'memberId' ? 'Assignee' : 'Requester';
      if (hasSharedOld && oldName) {
        const key = `activity.bulkChanged${keyBase}`;
        detailsEn = t(key, {
          oldName: oldName.en,
          newName: newName.en,
          count,
          boardTitle: boardTitleEn,
        }, 'en');
        detailsFr = t(key, {
          oldName: oldName.fr,
          newName: newName.fr,
          count,
          boardTitle: boardTitleFr,
        }, 'fr');
      } else {
        const key = `activity.bulkChanged${keyBase}To`;
        detailsEn = t(key, {
          newName: newName.en,
          count,
          boardTitle: boardTitleEn,
        }, 'en');
        detailsFr = t(key, {
          newName: newName.fr,
          count,
          boardTitle: boardTitleFr,
        }, 'fr');
      }
    } else if (field === 'priorityId') {
      const newLabel = payload.newLabel || String(payload.newValue ?? '');
      detailsEn = t('activity.bulkChangedPriority', {
        newValue: newLabel,
        count,
        boardTitle: boardTitleEn,
      }, 'en');
      detailsFr = t('activity.bulkChangedPriority', {
        newValue: newLabel,
        count,
        boardTitle: boardTitleFr,
      }, 'fr');
    } else if (field === 'sprintId') {
      if (payload.newValue === null || payload.newValue === undefined || payload.newValue === '') {
        detailsEn = t('activity.bulkClearedSprint', { count, boardTitle: boardTitleEn }, 'en');
        detailsFr = t('activity.bulkClearedSprint', { count, boardTitle: boardTitleFr }, 'fr');
      } else {
        const newLabel = payload.newLabel || String(payload.newValue);
        detailsEn = t('activity.bulkChangedSprint', {
          newValue: newLabel,
          count,
          boardTitle: boardTitleEn,
        }, 'en');
        detailsFr = t('activity.bulkChangedSprint', {
          newValue: newLabel,
          count,
          boardTitle: boardTitleFr,
        }, 'fr');
      }
    } else {
      console.warn(`Unsupported bulk activity field: ${field}`);
      return;
    }

    if (projectIdentifier) {
      const suffix = ` (${projectIdentifier})`;
      detailsEn += suffix;
      detailsFr += suffix;
    }

    const details = stringifyActivityDetails(
      { en: detailsEn, fr: detailsFr, bulk: true, taskIds, field },
      additionalData
    );

    await logActivity(userId, 'update_task', details, {
      ...additionalData,
      db: database,
      boardId,
      taskId: null,
    });

    // One digest email per involved recipient (not N per-task emails)
    notifyBulkTaskFieldActivity(
      database,
      {
        userId,
        field,
        taskIds,
        oldValue: payload.oldValue ?? null,
        newValue: payload.newValue ?? null,
        newLabel: payload.newLabel ?? null,
        reason: payload.reason ?? null,
        details,
      },
      additionalData.tenantId || null
    ).catch((err) => {
      console.error('❌ Error sending bulk task field emails:', err);
    });
  } catch (error) {
    console.error('❌ Error logging bulk task activity:', error);
  }
};

/**
 * Log a team-facing "joined the team" feed item once per user (first invite/SSO activation).
 * Skips password resets and later re-activations when a prior join/activation row exists.
 */
export const logMemberJoinedIfFirstTime = async (userId, additionalData = {}) => {
  const database = additionalData.db || db;
  if (!database || !userId) return false;

  try {
    const alreadyJoined = await activityQueries.hasUserJoinActivity(database, userId);
    if (alreadyJoined) return false;

    const details = JSON.stringify(getBilingualTranslation('activity.joinedTeam'));
    await logActivity(userId, MEMBER_ACTIONS.JOINED, details, {
      ...additionalData,
      db: database,
    });
    return true;
  } catch (error) {
    console.error('❌ Error logging member joined activity:', error);
    return false;
  }
};
