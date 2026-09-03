/**
 * SQL Manager - Centralized Query Management
 * 
 * This module provides centralized PostgreSQL-native queries organized by domain.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, json_agg, etc.)
 * 
 * Usage:
 *   import { tasks } from '../utils/sqlManager/index.js';
 *   const task = await tasks.getTaskById(db, taskId);
 */

import * as tasks from './tasks.js';
import * as helpers from './helpers.js';
import * as boards from './boards.js';
import * as comments from './comments.js';
import * as priorities from './priorities.js';
import * as sprints from './sprints.js';
import * as users from './users.js';
import * as reports from './reports.js';
import * as settings from './settings.js';
import * as files from './files.js';
import * as activity from './activity.js';
import * as health from './health.js';
import * as members from './members.js';
import * as auth from './auth.js';
import * as tags from './tags.js';
import * as views from './views.js';
import * as passwordReset from './passwordReset.js';
import * as adminUsers from './adminUsers.js';
import * as licenseSettings from './licenseSettings.js';
import * as notificationQueue from './notificationQueue.js';
import * as taskWork from './taskWork.js';
import * as userApiTokens from './userApiTokens.js';
import * as userSshKeys from './userSshKeys.js';
import * as userGithubTokens from './userGithubTokens.js';
import * as automationTokens from './automationTokens.js';
import * as automationJournal from './automationJournal.js';
import * as cspReports from './cspReports.js';
import * as webhooks from './webhooks.js';
import * as boardParticipants from './boardParticipants.js';
import * as acceptanceCriteria from './acceptanceCriteria.js';

// Export all domain managers
export const sqlManager = {
  tasks,
  helpers,
  boards,
  comments,
  priorities,
  sprints,
  users,
  reports,
  settings,
  files,
  activity,
  health,
  members,
  auth,
  tags,
  views,
  passwordReset,
  adminUsers,
  licenseSettings,
  notificationQueue,
  taskWork,
  userApiTokens,
  userSshKeys,
  userGithubTokens,
  automationTokens,
  automationJournal,
  cspReports,
  webhooks,
  boardParticipants,
  acceptanceCriteria
};

// Also export individual domains for convenience
export { tasks, helpers, boards, comments, priorities, sprints, users, reports, settings, files, activity, health, members, auth, tags, views, passwordReset, adminUsers, licenseSettings, notificationQueue, taskWork, userApiTokens, userSshKeys, userGithubTokens, automationTokens, automationJournal, cspReports, webhooks, boardParticipants, acceptanceCriteria };
// export { users };
// etc.

export default sqlManager;

