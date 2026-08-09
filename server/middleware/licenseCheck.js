// License checking middleware
import { getLicenseManager } from '../config/license.js';
import { getRequestDatabase } from './tenantRouting.js';

// Middleware to check user limit before creating users
export const checkUserLimit = (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  
  if (!licenseManager.isEnabled()) {
    return next(); // Skip license checks when disabled
  }

  licenseManager.checkUserLimit()
    .then(() => next())
    .catch(error => {
      res.status(403).json({
        error: 'License limit exceeded',
        details: error.message,
        limit: 'USER_LIMIT'
      });
    });
};

// Middleware to check task limit before creating tasks
export const checkTaskLimit = (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  
  if (!licenseManager.isEnabled()) {
    return next(); // Skip license checks when disabled
  }

  const boardId = req.body.boardId || req.params.boardId;
  if (!boardId) {
    return res.status(400).json({ error: 'Board ID is required for task limit check' });
  }

  licenseManager.checkTaskLimit(boardId)
    .then(() => next())
    .catch(error => {
      res.status(403).json({
        error: 'License limit exceeded',
        details: error.message,
        limit: 'TASK_LIMIT'
      });
    });
};

// Middleware to check board limit before creating boards
export const checkBoardLimit = (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  
  if (!licenseManager.isEnabled()) {
    return next(); // Skip license checks when disabled
  }

  licenseManager.checkBoardLimit()
    .then(() => next())
    .catch(error => {
      res.status(403).json({
        error: 'License limit exceeded',
        details: error.message,
        limit: 'BOARD_LIMIT',
        liveCount: error.liveCount ?? null,
        softDeletedCount: error.softDeletedCount ?? null,
        boardLimit: error.boardLimit ?? null,
      });
    });
};

// Middleware to check storage limit before file uploads
export const checkStorageLimit = (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  
  if (!licenseManager.isEnabled()) {
    return next(); // Skip license checks when disabled
  }

  const additionalBytes =
    (req.file && req.file.size) ||
    parseInt(req.headers['content-length'], 10) ||
    0;

  licenseManager.checkStorageLimit(additionalBytes)
    .then(() => next())
    .catch(error => {
      res.status(403).json({
        error: 'License limit exceeded',
        details: error.message,
        limit: 'STORAGE_LIMIT'
      });
    });
};

// Middleware to inject license info into request
export const injectLicenseInfo = async (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  req.licenseInfo = await licenseManager.getLicenseInfo();
  next();
};
