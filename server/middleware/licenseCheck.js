// License checking middleware
import { getLicenseManager } from '../config/license.js';
import { getRequestDatabase } from './tenantRouting.js';

export function licenseLimitBody(limit, error) {
  const body = {
    error: 'License limit exceeded',
    details: error?.message || String(error),
    limit,
    current: error?.current ?? null,
    maximum: error?.maximum ?? null,
  };
  if (limit === 'BOARD_LIMIT') {
    body.liveCount = error?.liveCount ?? null;
    body.softDeletedCount = error?.softDeletedCount ?? null;
    body.boardLimit = error?.boardLimit ?? null;
  }
  return body;
}

// Middleware to check user limit before creating users
export const checkUserLimit = (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  
  if (!licenseManager.isEnabled()) {
    return next(); // Skip license checks when disabled
  }

  licenseManager.checkUserLimit()
    .then(() => next())
    .catch(error => {
      res.status(403).json(licenseLimitBody('USER_LIMIT', error));
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
      res.status(403).json(licenseLimitBody('TASK_LIMIT', error));
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
      res.status(403).json(licenseLimitBody('BOARD_LIMIT', error));
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
      res.status(403).json(licenseLimitBody('STORAGE_LIMIT', error));
    });
};

// Middleware to inject license info into request
export const injectLicenseInfo = async (req, res, next) => {
  const licenseManager = getLicenseManager(getRequestDatabase(req));
  req.licenseInfo = await licenseManager.getLicenseInfo();
  next();
};
