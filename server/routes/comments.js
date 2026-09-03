import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { updateStorageUsage } from '../utils/storageUtils.js';
import { logCommentActivity } from '../services/activityLogger.js';
import * as reportingLogger from '../services/reportingLogger.js';
import { COMMENT_ACTIONS } from '../constants/activityActions.js';
import notificationService from '../services/notificationService.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
// MIGRATED: Import sqlManager
import { comments as commentQueries, helpers, tasks as taskQueries, members as memberQueries } from '../utils/sqlManager/index.js';
import { deleteObject, getRequestStoragePaths, filenameFromPublicUrl } from '../services/storage/index.js';
import {
  parseBody,
  createCommentBodySchema,
  updateCommentBodySchema
} from '../utils/requestValidation.js';
import { assertTaskBoardAccess } from '../middleware/boardAccess.js';

const router = express.Router();

function userIsAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.roles) && user.roles.includes('admin');
}

function commentAuthorId(comment) {
  return comment?.authorid || comment?.authorId || null;
}

async function resolveCallerMemberId(db, userId) {
  const member = await memberQueries.getMemberByUserId(db, userId);
  return member?.id || null;
}

function canModifyComment(user, comment, callerMemberId) {
  if (userIsAdmin(user)) return true;
  const authorId = commentAuthorId(comment);
  return Boolean(callerMemberId && authorId && callerMemberId === authorId);
}

// Create comment endpoint
router.post('/', authenticateToken, async (req, res) => {
  const parsed = parseBody(createCommentBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const comment = parsed.data;
  const userId = req.user.id;
  const db = getRequestDatabase(req);
  
  try {
    if (!(await assertTaskBoardAccess(req, res, comment.taskId))) return;
    const callerMemberId = await resolveCallerMemberId(db, userId);
    if (!callerMemberId) {
      return res.status(400).json({ error: 'No member profile linked to this user' });
    }

    // Always bind author to the authenticated user's member (ignore client authorId)
    const authorId = callerMemberId;
    const createdAt = comment.createdAt != null
      ? String(comment.createdAt)
      : new Date().toISOString();
    
    // Collect queries and send as a batched transaction
    const batchQueries = [];
    
    // Add comment INSERT
    batchQueries.push({
      query: `
        INSERT INTO comments (id, taskid, text, authorid, createdat)
        VALUES (?, ?, ?, ?, ?)
      `,
      params: [
        comment.id,
        comment.taskId,
        comment.text,
        authorId,
        createdAt
      ]
    });
    
    // Add attachment INSERTs if any
    if (comment.attachments?.length > 0) {
      const attachmentQuery = `
        INSERT INTO attachments (id, commentid, name, url, type, size)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      for (const attachment of comment.attachments) {
        batchQueries.push({
          query: attachmentQuery,
          params: [
            attachment.id,
            comment.id,
            attachment.name,
            attachment.url,
            attachment.type,
            attachment.size
          ]
        });
      }
    }
    
    // Execute all inserts in a single batched transaction
    await db.executeBatchTransaction(batchQueries);

    
    // Update storage usage if attachments were added
    if (comment.attachments?.length > 0) {
      await updateStorageUsage(db);
    }
    
    // Log comment creation activity
    await logCommentActivity(
      userId,
      COMMENT_ACTIONS.CREATE,
      comment.id,
      comment.taskId,
      `added comment: "${comment.text.length > 50 ? comment.text.substring(0, 50) + '...' : comment.text}"`,
      {
        commentContent: comment.text,
        db: db,
        tenantId: getTenantId(req),
        authType: req.user?.authType
      }
    );
    
    // Log to reporting system
    try {
      const userInfo = await reportingLogger.getUserInfo(db, userId);
      // MIGRATED: Use sqlManager to get task info with board/column titles
      const taskInfo = await taskQueries.getTaskWithBoardColumnInfo(db, comment.taskId);
      
      if (userInfo && taskInfo) {
        await reportingLogger.logActivity(db, {
          eventType: 'comment_added',
          userId: userInfo.id,
          userName: userInfo.name,
          userEmail: userInfo.email,
          taskId: taskInfo.id,
          taskTitle: taskInfo.title,
          taskTicket: taskInfo.ticket,
          boardId: taskInfo.boardId,
          boardName: taskInfo.board_title,
          columnId: taskInfo.columnId,
          columnName: taskInfo.column_title,
          effortPoints: taskInfo.effort,
          priorityName: taskInfo.priority
        });
      }
    } catch (reportError) {
      console.error('Failed to log comment to reporting system:', reportError);
    }
    
    // MIGRATED: Get the task's board ID using sqlManager
    const task = await taskQueries.getTaskBoardId(db, comment.taskId);
    
    // MIGRATED: Fetch the complete comment with attachments using sqlManager
    const createdComment = await commentQueries.getCommentById(db, comment.id);
    
    if (!createdComment) {
      return res.status(500).json({ error: 'Failed to retrieve created comment' });
    }
    
    // MIGRATED: Get attachments using sqlManager
    const attachments = await helpers.getAttachmentsForComment(db, comment.id);
    createdComment.attachments = attachments || [];
    
    // Ensure taskId is included in the comment object
    if (!createdComment.taskId) {
      createdComment.taskId = comment.taskId;
    }
    
    // Publish to Redis for real-time updates
    // Note: getTaskBoardId returns boardid string or null
    if (task) {
      const tenantId = getTenantId(req);
      console.log('📤 Publishing comment-created to Redis for board:', task);
      await notificationService.publish('comment-created', {
        boardId: task,  // task is already the boardId string
        taskId: comment.taskId,
        comment: createdComment,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ Comment-created published to Redis');
    } else {
      console.warn('⚠️ Cannot publish comment-created: task boardId not found for taskId:', comment.taskId);
    }
    
    res.json(createdComment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Update comment endpoint
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const parsed = parseBody(updateCommentBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { text } = parsed.data;
  const userId = req.user.id;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Get original comment using sqlManager
    const originalComment = await commentQueries.getCommentSimple(db, id);
    
    if (!originalComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (!(await assertTaskBoardAccess(req, res, originalComment.taskid || originalComment.taskId))) return;

    const callerMemberId = await resolveCallerMemberId(db, userId);
    if (!canModifyComment(req.user, originalComment, callerMemberId)) {
      return res.status(403).json({ error: 'Insufficient permissions to modify this comment' });
    }
    
    // MIGRATED: Update comment text using sqlManager
    const result = await commentQueries.updateComment(db, id, text);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    // Log comment update activity
    await logCommentActivity(
      userId,
      COMMENT_ACTIONS.UPDATE,
      id,
      originalComment.taskId,
      `updated comment from: "${originalComment.text.length > 30 ? originalComment.text.substring(0, 30) + '...' : originalComment.text}" to: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`,
      { db: db, tenantId: getTenantId(req), authType: req.user?.authType }
    );
    
    // MIGRATED: Get the task's board ID using sqlManager
    const task = await taskQueries.getTaskBoardId(db, originalComment.taskid || originalComment.taskId);
    
    // MIGRATED: Return updated comment with attachments using sqlManager
    const updatedComment = await commentQueries.getCommentById(db, id);
    
    if (!updatedComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    // MIGRATED: Get attachments using sqlManager
    const attachments = await helpers.getAttachmentsForComment(db, id);
    updatedComment.attachments = attachments || [];
    
    // Publish to Redis for real-time updates
    // Note: getTaskBoardId returns boardid string or null
    const taskId = originalComment.taskid || originalComment.taskId;
    if (task) {
      const tenantId = getTenantId(req);
      console.log('📤 Publishing comment-updated to Redis for board:', task);
      await notificationService.publish('comment-updated', {
        boardId: task,
        taskId: taskId,
        comment: updatedComment,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ Comment-updated published to Redis');
    }
    
    res.json(updatedComment);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete comment endpoint
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Get comment details before deleting using sqlManager
    const commentToDelete = await commentQueries.getCommentSimple(db, id);
    
    if (!commentToDelete) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (!(await assertTaskBoardAccess(req, res, commentToDelete.taskid || commentToDelete.taskId))) return;

    const callerMemberId = await resolveCallerMemberId(db, userId);
    if (!canModifyComment(req.user, commentToDelete, callerMemberId)) {
      return res.status(403).json({ error: 'Insufficient permissions to delete this comment' });
    }
    
    // MIGRATED: Get attachments before deleting the comment using sqlManager
    const attachments = await helpers.getAttachmentsForComment(db, id);

    const storagePaths = getRequestStoragePaths(req);
    
    // Delete attachment objects (disk and/or S3)
    for (const attachment of attachments) {
      const filename = filenameFromPublicUrl(attachment.url, 'attachments');
      if (!filename) continue;
      try {
        await deleteObject(db, storagePaths, 'attachments', filename);
        console.log(`✅ Deleted file: ${filename}`);
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }

    // MIGRATED: Delete the comment using sqlManager (cascades to attachments)
    await commentQueries.deleteComment(db, id);
    
    // Update storage usage after deleting comment (which cascades to attachments)
    await updateStorageUsage(db);

    // Log comment deletion activity
    await logCommentActivity(
      userId,
      COMMENT_ACTIONS.DELETE,
      id,
      commentToDelete.taskId,
      `deleted comment: "${commentToDelete.text.length > 50 ? commentToDelete.text.substring(0, 50) + '...' : commentToDelete.text}"`,
      { db: db, tenantId: getTenantId(req), authType: req.user?.authType }
    );

    // MIGRATED: Get the task's board ID using sqlManager
    const taskId = commentToDelete.taskid || commentToDelete.taskId;
    const task = await taskQueries.getTaskBoardId(db, taskId);
    
    // Publish to Redis for real-time updates
    // Note: getTaskBoardId returns boardid string or null
    if (task) {
      const tenantId = getTenantId(req);
      console.log('📤 Publishing comment-deleted to Redis for board:', task);
      await notificationService.publish('comment-deleted', {
        boardId: task,
        taskId: taskId,
        commentId: id,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ Comment-deleted published to Redis');
    }

    res.json({ message: 'Comment and attachments deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Get comment attachments endpoint
router.get('/:commentId/attachments', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const comment = await commentQueries.getCommentSimple(db, req.params.commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (!(await assertTaskBoardAccess(req, res, comment.taskid || comment.taskId))) return;
    // MIGRATED: Get attachments using sqlManager
    const attachments = await helpers.getAttachmentsForComment(db, req.params.commentId);

    res.json(attachments);
  } catch (error) {
    console.error('Error fetching comment attachments:', error);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

export default router;
