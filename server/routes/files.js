import express from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import { authenticateToken, JWT_SECRET, userMayUseSession } from '../middleware/auth.js';
import { updateStorageUsage } from '../utils/storageUtils.js';
import notificationService from '../services/notificationService.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { files as fileQueries, tasks as taskQueries } from '../utils/sqlManager/index.js';
import { assertTaskBoardAccess } from '../middleware/boardAccess.js';
import {
  getObject,
  deleteObject,
  getRequestStoragePaths,
  filenameFromPublicUrl
} from '../services/storage/index.js';
import {
  MEDIA_COOKIE_NAME,
  mediaCookieOptions,
  resolveFileAccessCredential,
  signMediaAccessToken,
  isMediaPurposeToken
} from '../utils/mediaAccessToken.js';

const router = express.Router();

/** Legacy uploads that are scriptable — force download instead of inline render. */
const FORCE_DOWNLOAD_MIME = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript'
]);

function setFileResponseHeaders(res, filename, contentType) {
  const mime = String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Authenticated media must not be stored in shared caches
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (FORCE_DOWNLOAD_MIME.has(mime) || /\.(svg|html?|xhtml|js|mjs)$/i.test(filename)) {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);
  }
}

/**
 * Verify media credential: signature + user exists + active (not deactivated / force_logout).
 * Query-string tokens must be purpose=media (no session JWT in URLs — I3 cutover).
 * Cookie and Bearer may carry media or session JWTs.
 * @returns {{ ok: true, decoded: object, db: object } | { ok: false, status: number, error: string }}
 */
async function assertActiveFileUser(req, token, via) {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return { ok: false, status: 401, error: 'Invalid token' };
  }

  if (!decoded?.id) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }

  // I3: session JWTs in ?token= are no longer accepted (leak via Referer/history/logs)
  if (via === 'query' && !isMediaPurposeToken(decoded)) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }

  const db = getRequestDatabase(req);
  if (!db) {
    return { ok: false, status: 500, error: 'Database not available' };
  }

  try {
    const userInDb = await fileQueries.getUserByIdForFileAccess(db, decoded.id);
    if (!userMayUseSession(userInDb)) {
      return { ok: false, status: 401, error: userInDb ? 'Invalid token' : 'Invalid token for this tenant' };
    }
  } catch (dbError) {
    console.error('❌ Error checking user for file access:', dbError);
    return { ok: false, status: 401, error: 'Authentication failed' };
  }

  return { ok: true, decoded, db };
}

async function serveAuthenticatedFile(req, res, kind) {
  const cred = resolveFileAccessCredential(req);
  if (!cred) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const auth = await assertActiveFileUser(req, cred.token, cred.via);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const storagePaths = getRequestStoragePaths(req);
    const safeName = path.basename(req.params.filename);
    const obj = await getObject(auth.db, storagePaths, kind, safeName);

    if (!obj) {
      return res.status(404).json({ error: 'File not found' });
    }

    setFileResponseHeaders(res, safeName, obj.contentType);
    res.send(obj.buffer);
  } catch (error) {
    console.error(`Error serving ${kind}:`, error);
    res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Establish HttpOnly media cookie so same-origin <img>/attachment URLs
 * do not need ?token=<session JWT>. Call after login / on session restore.
 */
router.post('/media-session', authenticateToken, (req, res) => {
  try {
    const token = signMediaAccessToken(req.user.id);
    res.cookie(MEDIA_COOKIE_NAME, token, mediaCookieOptions(req));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error establishing media session:', error);
    res.status(500).json({ error: 'Failed to establish media session' });
  }
});

/** Clear media cookie on logout. */
router.delete('/media-session', (req, res) => {
  res.clearCookie(MEDIA_COOKIE_NAME, { path: '/api/files' });
  res.json({ ok: true });
});

// Serve attachment files (tenant-aware in multi-tenant mode)
router.get('/attachments/:filename', async (req, res) => {
  await serveAuthenticatedFile(req, res, 'attachments');
});

// Serve avatar files (tenant-aware in multi-tenant mode)
router.get('/avatars/:filename', async (req, res) => {
  await serveAuthenticatedFile(req, res, 'avatars');
});

// Delete attachment endpoint
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    const attachment = await fileQueries.getAttachmentById(db, id);
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    if (!(await assertTaskBoardAccess(req, res, attachment.taskId || attachment.taskid))) return;
    
    const filename = filenameFromPublicUrl(attachment.url, 'attachments');
    if (filename) {
      const storagePaths = getRequestStoragePaths(req);
      try {
        await deleteObject(db, storagePaths, 'attachments', filename);
        console.log(`✅ Deleted file: ${filename}`);
      } catch (fileError) {
        console.error('Error deleting file:', fileError);
      }
    }
    
    const result = await fileQueries.deleteAttachment(db, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Attachment record not found' });
    }
    
    await updateStorageUsage(db);
    
    const task = await fileQueries.getTaskByIdForFiles(db, attachment.taskId);
    
    if (task?.boardId) {
      const taskWithRelationships = await taskQueries.getTaskWithRelationships(db, attachment.taskId);
      
      if (taskWithRelationships) {
        const taskResponse = taskWithRelationships;
        const tenantId = req.tenantId || null;
        await notificationService.publish('task-updated', {
          boardId: task.boardId,
          task: taskResponse,
          timestamp: new Date().toISOString()
        }, tenantId);
      }
      
      console.log('📤 Publishing attachment-deleted to Redis for board:', task.boardId);
      const tenantId = req.tenantId || null;
      await notificationService.publish('attachment-deleted', {
        boardId: task.boardId,
        taskId: attachment.taskId,
        attachmentId: id,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ Attachment-deleted published to Redis');
    }
    
    res.json({ message: 'Attachment and file deleted successfully' });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
