# WebSocket Publish Endpoints - Complete List

> **Transport note:** Endpoints call `notificationService.publish()`, which uses **PostgreSQL `LISTEN`/`NOTIFY`**. Redis is **not** the app event bus (it is only the Socket.IO adapter across pods). See [`REALTIME_UPDATE_FLOW-MULTI-TENANCY.md`](./REALTIME_UPDATE_FLOW-MULTI-TENANCY.md).

This document lists endpoints that publish for real-time WebSocket updates, organized by file and endpoint. Line numbers may drift; treat channel names and payload shapes as the source of truth.

## Summary

**Total Endpoints**: ~91 publish calls across 15 files

**Categories**:
- **Tasks**: 17 publish calls
- **Comments**: 3 publish calls
- **Task Relations**: 4 publish calls (tags, attachments, relationships)
- **Users/Members**: 15 publish calls
- **Boards/Columns**: 8 publish calls
- **Settings/Config**: 5 publish calls
- **Tags/Priorities/Sprints**: 12 publish calls
- **Views/Filters**: 3 publish calls
- **Activity**: 3 publish calls
- **Other**: 17 publish calls (admin, jobs, etc.)

---

## TASKS (server/routes/tasks.js)

### Task CRUD Operations

1. **POST `/tasks`** - Create task
   - Channel: `task-created`
   - Line: 777
   - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }`
   - **Size**: ~5-30KB (full task with comments, watchers, collaborators, tags)
   - **Optimization**: Send full task (frontend doesn't have it yet)

2. **POST `/tasks/add-at-top`** - Create task at top
   - Channel: `task-created`
   - Line: 886
   - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }`
   - **Size**: ~5-30KB
   - **Optimization**: Send full task (frontend doesn't have it yet)

3. **PUT `/tasks/:id`** - Update task
   - Channel: `task-updated`
   - Line: 1101
   - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }`
   - **Size**: ~5-30KB
   - **Optimization**: ⚠️ **HIGH PRIORITY** - Send only changed fields

4. **DELETE `/tasks/:id`** - Delete task
   - Channel: `task-deleted`
   - Line: 1395
   - Payload: `{ boardId, taskId, timestamp }`
   - **Size**: ~200 bytes (already minimal)
   - **Optimization**: ✅ Already optimized

### Task Position/Movement Operations

5. **POST `/tasks/batch-update`** - Batch update tasks
   - Channel: `task-updated`
   - Line: 1256
   - Payload: `{ boardId, task: fullTask, timestamp }` (per task)
   - **Size**: ~5-30KB per task
   - **Optimization**: ⚠️ Send only changed fields (position, columnId)

6. **POST `/tasks/batch-update-positions`** - Batch update positions (drag-and-drop)
   - Channel: `task-updated`
   - Line: 1619
   - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }` (per task)
   - **Size**: ~5-30KB per task × N tasks
   - **Optimization**: ⚠️ **HIGH PRIORITY** - Send only position/columnId changes

7. **POST `/tasks/reorder`** - Reorder task
   - Channel: `task-updated`
   - Line: 1779
   - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }`
   - **Size**: ~5-30KB
   - **Optimization**: ⚠️ Send only position change

8. **POST `/tasks/move-to-board`** - Move task to different board
   - Channels: `task-updated` (source + dest board rooms), then `task-deleted` (source) + `task-created` (dest) tenant-wide for tab counters
   - Payload (updated): `{ boardId, task: fullTaskWithRelationships, timestamp }`
   - Payload (deleted): `{ boardId: sourceBoardId, taskId, movedToBoardId, timestamp }`
   - **Size**: ~5-30KB × 2 updates + compact membership events
   - **Optimization**: ⚠️ Send only boardId, columnId, position changes

### Task Collaboration Operations

9. **POST `/tasks/:taskId/watchers`** - Add watcher
   - Channel: `task-watcher-added`
   - Line: 2073
   - Payload: `{ boardId, taskId, memberId, timestamp }`
   - **Size**: ~200 bytes (already minimal)
   - **Optimization**: ✅ Already optimized

10. **DELETE `/tasks/:taskId/watchers/:memberId`** - Remove watcher
    - Channel: `task-watcher-removed`
    - Line: 2107
    - Payload: `{ boardId, taskId, memberId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

11. **POST `/tasks/:taskId/collaborators`** - Add collaborator
    - Channel: `task-collaborator-added`
    - Line: 2148
    - Payload: `{ boardId, taskId, memberId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

12. **DELETE `/tasks/:taskId/collaborators/:memberId`** - Remove collaborator
    - Channel: `task-collaborator-removed`
    - Line: 2182
    - Payload: `{ boardId, taskId, memberId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Task Relationship Operations

13. **POST `/tasks/:taskId/relationships`** - Create task relationship
    - Channel: `task-relationship-created` (2 publishes - source and target tasks)
    - Lines: 2334, 2344
    - Payload: `{ boardId, taskId, relationship, relatedTaskId, timestamp }`
    - **Size**: ~300 bytes each
    - **Optimization**: ✅ Already optimized

14. **DELETE `/tasks/:taskId/relationships/:relationshipId`** - Delete task relationship
    - Channel: `task-relationship-deleted` (2 publishes - source and target tasks)
    - Lines: 2404, 2414
    - Payload: `{ boardId, taskId, relationship, relatedTaskId, timestamp }`
    - **Size**: ~300 bytes each
    - **Optimization**: ✅ Already optimized

---

## 💬 COMMENTS (server/routes/comments.js)

15. **POST `/comments`** - Create comment
    - Channel: `comment-created`
    - Line: 186
    - Payload: `{ boardId, taskId, comment: fullComment, timestamp }`
    - **Size**: ~500 bytes - 2KB (comment with attachments)
    - **Optimization**: ⚠️ Could send minimal comment, frontend can fetch full if needed

16. **PUT `/comments/:id`** - Update comment
    - Channel: `comment-updated`
    - Line: 267
    - Payload: `{ boardId, taskId, comment: fullComment, timestamp }`
    - **Size**: ~500 bytes - 2KB
    - **Optimization**: ⚠️ Send only changed fields (text, attachments)

17. **DELETE `/comments/:id`** - Delete comment
    - Channel: `comment-deleted`
    - Line: 357
    - Payload: `{ boardId, taskId, commentId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

---

## 🏷️ TASK RELATIONS (server/routes/taskRelations.js)

18. **POST `/tasks/:taskId/tags`** - Add tag to task
    - Channel: `task-tag-added`
    - Line: 116
    - Payload: `{ boardId, taskId, tagId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

19. **DELETE `/tasks/:taskId/tags/:tagId`** - Remove tag from task
    - Channel: `task-tag-removed`
    - Line: 173
    - Payload: `{ boardId, taskId, tagId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

20. **POST `/tasks/:taskId/attachments`** - Add attachments to task
    - Channel: `task-updated` (full task)
    - Line: 570
    - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }`
    - **Size**: ~5-30KB
    - **Optimization**: ⚠️ Send only attachmentCount or new attachments array

21. **POST `/tasks/:taskId/attachments`** - Add attachments (alternative)
    - Channel: `task-attachments-added`
    - Line: 583
    - Payload: `{ boardId, taskId, attachments: array, timestamp }`
    - **Size**: ~1-5KB (attachments array)
    - **Optimization**: ⚠️ Already reasonable, but could be smaller

---

## 👥 USERS & MEMBERS

### Users (server/routes/users.js)

22. **PUT `/users/profile/avatar`** - Update user avatar
    - Channel: `user-profile-updated`
    - Line: 85
    - Payload: `{ userId, memberId, avatarPath, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

23. **DELETE `/users/profile/avatar`** - Remove user avatar
    - Channel: `user-profile-updated`
    - Line: 121
    - Payload: `{ userId, memberId, avatarPath: null, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

24. **PUT `/users/profile/display-name`** - Update display name
    - Channel: `user-profile-updated`
    - Line: 176
    - Payload: `{ userId, memberId, displayName, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

25. **DELETE `/users/account`** - Delete user account
    - Channel: `task-updated` (for reassigned tasks)
    - Line: 355
    - Payload: `{ boardId, task: fullTask, timestamp }` (per task)
    - **Size**: ~5-30KB per task
    - **Optimization**: ⚠️ Send only memberId change

26. **DELETE `/users/account`** - Delete user account
    - Channel: `member-deleted`
    - Line: 374
    - Payload: `{ userId, memberId, userName, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

27. **DELETE `/users/account`** - Delete user account
    - Channel: `user-deleted`
    - Line: 386
    - Payload: `{ userId, user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Members (server/routes/members.js)

28. **POST `/members`** - Create member
    - Channel: `member-created`
    - Line: 80
    - Payload: `{ member: { id, name, color }, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

29. **DELETE `/members/:id`** - Delete member
    - Channel: `member-deleted`
    - Line: 102
    - Payload: `{ memberId, timestamp }`
    - **Size**: ~150 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Admin Users (server/routes/adminUsers.js)

30. **PUT `/admin/users/:userId`** - Update user (admin)
    - Channel: `member-updated`
    - Line: 111
    - Payload: `{ memberId, member: { id, name, color }, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

31. **PUT `/admin/users/:userId`** - Update user (admin)
    - Channel: `user-updated`
    - Line: 186
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

32. **PUT `/admin/users/:userId`** - Update user role (admin)
    - Channel: `user-role-updated`
    - Line: 249
    - Payload: `{ userId, role, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

33. **POST `/admin/users`** - Create user (admin)
    - Channel: `user-created`
    - Line: 498
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

34. **POST `/admin/users`** - Create user (admin)
    - Channel: `member-created`
    - Line: 518
    - Payload: `{ member: { id, name, color }, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

35. **DELETE `/admin/users/:userId`** - Delete user (admin)
    - Channel: `task-updated` (for reassigned tasks)
    - Line: 881
    - Payload: `{ boardId, task: fullTask, timestamp }` (per task)
    - **Size**: ~5-30KB per task
    - **Optimization**: ⚠️ Send only memberId change

36. **DELETE `/admin/users/:userId`** - Delete user (admin)
    - Channel: `member-deleted`
    - Line: 898
    - Payload: `{ memberId, timestamp }`
    - **Size**: ~150 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

37. **DELETE `/admin/users/:userId`** - Delete user (admin)
    - Channel: `user-deleted`
    - Line: 907
    - Payload: `{ userId, user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

38. **PUT `/admin/users/:userId/activate`** - Activate/deactivate user
    - Channel: `member-updated`
    - Line: 959
    - Payload: `{ memberId, member: { id, name, color }, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

39. **PUT `/admin/users/:userId/activate`** - Activate/deactivate user
    - Channel: `user-profile-updated` (2 publishes)
    - Lines: 993, 1027
    - Payload: `{ userId, memberId, ...profileData, timestamp }`
    - **Size**: ~300 bytes each (already minimal)
    - **Optimization**: ✅ Already optimized

### Admin Portal (server/routes/adminPortal.js)

40. **PUT `/admin-portal/users/:userId`** - Update user (admin portal)
    - Channel: `user-updated`
    - Line: 1201
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

41. **PUT `/admin-portal/users/:userId`** - Update user role (admin portal)
    - Channel: `user-role-updated`
    - Line: 1219
    - Payload: `{ userId, role, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Auth (server/routes/auth.js)

42. **POST `/auth/register`** - Register user
    - Channel: `user-updated`
    - Line: 169
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

43. **POST `/auth/google/callback`** - Google OAuth callback
    - Channel: `user-updated`
    - Line: 643
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

44. **POST `/auth/google/callback`** - Google OAuth callback
    - Channel: `member-updated`
    - Line: 662
    - Payload: `{ memberId, member: { id, name, color }, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

---

## 📋 BOARDS & COLUMNS

### Boards (server/routes/boards.js)

45. **POST `/boards`** - Create board
    - Channel: `column-created` (for default columns)
    - Line: 244
    - Payload: `{ boardId, column: fullColumn, timestamp }` (per column)
    - **Size**: ~300 bytes per column
    - **Optimization**: ✅ Already optimized

46. **POST `/boards`** - Create board
    - Channel: `board-created`
    - Line: 262
    - Payload: `{ boardId, board: fullBoard, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

47. **PUT `/boards/:id`** - Update board
    - Channel: `board-updated`
    - Line: 318
    - Payload: `{ boardId, board: { id, title }, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

48. **DELETE `/boards/:id`** - Delete board
    - Channel: `board-deleted`
    - Line: 342
    - Payload: `{ boardId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

49. **POST `/boards/reorder`** - Reorder boards
    - Channel: `board-reordered`
    - Line: 425
    - Payload: `{ boardId, newPosition, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Columns (server/routes/columns.js)

50. **POST `/columns`** - Create column
    - Channel: `column-created`
    - Line: 65
    - Payload: `{ boardId, column: fullColumn, updatedBy, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

51. **PUT `/columns/:id`** - Update column
    - Channel: `column-updated`
    - Line: 141
    - Payload: `{ boardId, column: fullColumn, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

52. **DELETE `/columns/:id`** - Delete column
    - Channel: `column-deleted`
    - Line: 174
    - Payload: `{ boardId, columnId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

53. **POST `/columns/reorder`** - Reorder columns
    - Channel: `column-reordered`
    - Line: 230
    - Payload: `{ boardId, columns: array, timestamp }`
    - **Size**: ~1-2KB (columns array)
    - **Optimization**: ⚠️ Could send only positions, but current size is reasonable

---

## ⚙️ SETTINGS (server/routes/settings.js)

54. **PUT `/settings/:key`** - Update setting
    - Channel: `settings-updated`
    - Line: 124
    - Payload: `{ key, value, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

55. **POST `/settings/clear-mail`** - Clear mail settings
    - Channel: `settings-updated`
    - Line: 305
    - Payload: `{ key: 'MAIL_SETTINGS_CLEARED', value: 'all', timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

---

## 🏷️ TAGS (server/routes/tags.js)

56. **POST `/tags`** - Create tag
    - Channel: `tag-created`
    - Line: 56
    - Payload: `{ tag: fullTag, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

57. **POST `/tags`** - Create tag (alternative)
    - Channel: `tag-created`
    - Line: 102
    - Payload: `{ tag: fullTag, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

58. **PUT `/tags/:id`** - Update tag
    - Channel: `tag-updated`
    - Line: 136
    - Payload: `{ tag: fullTag, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

59. **DELETE `/tags/:id`** - Delete tag
    - Channel: `tag-deleted`
    - Line: 235
    - Payload: `{ tagId, tag: fullTag, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

---

## 🎯 PRIORITIES (server/routes/priorities.js)

60. **POST `/priorities`** - Create priority
    - Channel: `priority-created`
    - Line: 133
    - Payload: `{ priority: fullPriority, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

61. **POST `/priorities/reorder`** - Reorder priorities
    - Channel: `priority-reordered`
    - Line: 193
    - Payload: `{ priorities: array, timestamp }`
    - **Size**: ~1-2KB (priorities array)
    - **Optimization**: ⚠️ Could send only positions, but current size is reasonable

62. **PUT `/priorities/:id`** - Update priority
    - Channel: `priority-updated`
    - Line: 224
    - Payload: `{ priority: fullPriority, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

63. **PUT `/priorities/:id`** - Update priority (triggers task updates)
    - Channel: `task-updated` (for affected tasks)
    - Line: 322
    - Payload: `{ boardId, task: fullTask, timestamp }` (per task)
    - **Size**: ~5-30KB per task
    - **Optimization**: ⚠️ Send only priority fields (priority, priorityId, priorityName, priorityColor)

64. **DELETE `/priorities/:id`** - Delete priority
    - Channel: `priority-deleted`
    - Line: 297
    - Payload: `{ priorityId, priority: fullPriority, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

---

## 🏃 SPRINTS (server/routes/sprints.js)

65. **POST `/sprints`** - Create sprint
    - Channel: `sprint-created`
    - Line: 129
    - Payload: `{ sprint: fullSprint, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

66. **PUT `/sprints/:id`** - Update sprint
    - Channel: `sprint-updated`
    - Line: 205
    - Payload: `{ sprint: fullSprint, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

67. **DELETE `/sprints/:id`** - Delete sprint
    - Channel: `sprint-deleted`
    - Line: 266
    - Payload: `{ sprintId, sprint: fullSprint, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

68. **DELETE `/sprints/:id`** - Delete sprint (triggers task updates)
    - Channel: `task-updated` (for affected tasks)
    - Line: 291
    - Payload: `{ boardId, task: fullTask, timestamp }` (per task)
    - **Size**: ~5-30KB per task
    - **Optimization**: ⚠️ Send only sprintId change (set to null)

---

## 🔍 VIEWS/FILTERS (server/routes/views.js)

69. **POST `/views`** - Create filter/view
    - Channel: `filter-created`
    - Line: 205
    - Payload: `{ filter: fullFilter, timestamp }`
    - **Size**: ~1-2KB (already minimal)
    - **Optimization**: ✅ Already optimized

70. **PUT `/views/:id`** - Update filter/view
    - Channel: `filter-updated`
    - Line: 308
    - Payload: `{ filter: fullFilter, timestamp }`
    - **Size**: ~1-2KB (already minimal)
    - **Optimization**: ✅ Already optimized

71. **DELETE `/views/:id`** - Delete filter/view
    - Channel: `filter-deleted`
    - Line: 353
    - Payload: `{ filterId, filterName, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

---

## 📊 ACTIVITY (server/services/activityLogger.js)

72. **Activity logging** - Various activity events
    - Channel: `activity-updated`
    - Lines: 233, 370, 747
    - Payload: `{ activities: array, timestamp }`
    - **Size**: ~2-10KB (activities array)
    - **Optimization**: ⚠️ Could send only new activities, but current size is reasonable

---

## 🔧 OTHER

### Files (server/routes/files.js)

73. **DELETE `/files/attachments/:id`** - Delete attachment
    - Channel: `task-updated` (full task)
    - Line: 311
    - Payload: `{ boardId, task: fullTaskWithRelationships, timestamp }`
    - **Size**: ~5-30KB
    - **Optimization**: ⚠️ Send only attachmentCount change

74. **DELETE `/files/attachments/:id`** - Delete attachment
    - Channel: `attachment-deleted`
    - Line: 321
    - Payload: `{ boardId, taskId, attachmentId, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Admin Portal (server/routes/adminPortal.js)

75. **POST `/admin-portal/users`** - Create user (admin portal)
    - Channel: `user-created`
    - Line: 372
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

76. **POST `/admin-portal/users`** - Create user (admin portal)
    - Channel: `member-created`
    - Line: 392
    - Payload: `{ member: { id, name, color }, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

77. **PUT `/admin-portal/users/:userId`** - Update user (admin portal)
    - Channel: `user-updated`
    - Line: 503
    - Payload: `{ user: fullUser, timestamp }`
    - **Size**: ~500 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

78. **PUT `/admin-portal/users/:userId`** - Update user role (admin portal)
    - Channel: `user-role-updated`
    - Line: 523
    - Payload: `{ userId, role, timestamp }`
    - **Size**: ~200 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

79. **POST `/admin-portal/instances/:instanceId/status`** - Update instance status
    - Channel: `instance-status-updated`
    - Line: 1082
    - Payload: `{ instanceId, status, timestamp }`
    - **Size**: ~300 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### System (server/index.js, server/middleware/tenantRouting.js)

80. **Version update** - App version changed
    - Channel: `version-updated`
    - Lines: server/index.js:502, server/middleware/tenantRouting.js:120
    - Payload: `{ version }`
    - **Size**: ~100 bytes (already minimal)
    - **Optimization**: ✅ Already optimized

### Jobs (server/jobs/)

81. **Achievements job** - Award achievements
    - Channel: `achievements-awarded`
    - Lines: server/jobs/achievements.js:362, server/jobs/achievementsNew.js:189
    - Payload: `{ achievements: array, timestamp }`
    - **Size**: ~1-5KB (achievements array)
    - **Optimization**: ✅ Already reasonable

82. **Task snapshots job** - Update snapshots
    - Channel: `task-snapshots-updated`
    - Line: server/jobs/taskSnapshots.js:348
    - Payload: `{ snapshot: data, timestamp }`
    - **Size**: ~1-2KB (already minimal)
    - **Optimization**: ✅ Already optimized

---

## Optimization Priority Summary

### HIGH PRIORITY (Large payloads, frequent operations)
1. **PUT `/tasks/:id`** - Task update (5-30KB)
2. **POST `/tasks/batch-update-positions`** - Batch position updates (5-30KB × N)
3. **POST `/tasks/move-to-board`** - Board moves (5-30KB × 2)
4. **POST `/tasks/reorder`** - Task reorder (5-30KB)
5. **POST `/tasks/batch-update`** - Batch updates (5-30KB × N)

### MEDIUM PRIORITY (Moderate payloads, less frequent)
6. **POST `/tasks/:taskId/attachments`** - Add attachments (5-30KB)
7. **DELETE `/files/attachments/:id`** - Delete attachment (5-30KB)
8. **POST `/comments`** - Create comment (500 bytes - 2KB)
9. **PUT `/comments/:id`** - Update comment (500 bytes - 2KB)
10. **PUT `/priorities/:id`** - Update priority (triggers task updates, 5-30KB × N)
11. **DELETE `/sprints/:id`** - Delete sprint (triggers task updates, 5-30KB × N)
12. **DELETE `/users/account`** - Delete user (triggers task updates, 5-30KB × N)
13. **DELETE `/admin/users/:userId`** - Delete user (triggers task updates, 5-30KB × N)

### LOW PRIORITY (Already optimized or minimal)
- All other endpoints are already sending minimal payloads (< 1KB)
- These can be optimized later if needed

---

## Optional payload-reduction ideas

**Starting Point**: Task CRUD operations (highest impact)

1. **PUT `/tasks/:id`** - Task update
   - Track changed fields
   - Send only changed fields + task ID
   - Frontend already supports merging

2. **POST `/tasks/batch-update-positions`** - Batch position updates
   - Send only position/columnId changes
   - Multiple tasks in single payload if possible

3. **POST `/tasks/reorder`** - Task reorder
   - Send only position change

4. **POST `/tasks/move-to-board`** - Board moves
   - Send only boardId/columnId/position changes

5. **POST `/tasks`** - Task creation
   - Keep full task (frontend doesn't have it yet)
   - But could optimize by not including all relationships if not needed

---

## Notes

- **Total publish calls**: ~91
- **High priority for optimization**: ~8 endpoints (task-related)
- **Already optimized**: ~83 endpoints
- **Estimated payload reduction**: 80-95% for task updates (from 5-30KB to 200-500 bytes)
- **Frontend compatibility**: Frontend already supports partial updates via merge logic
- **Transport**: App events use PostgreSQL LISTEN/NOTIFY via `notificationService.publish()`; Redis is Socket.IO adapter only


