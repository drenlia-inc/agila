---
name: easy-kanban-development
description: Build features for Agila (easy-kanban repo), a multi-tenant Kanban board application with Express backend and React frontend. Use when adding API endpoints, database migrations, real-time features, or working with the sqlManager abstraction layer, multi-tenant architecture, or authentication flows.
---

# Agila Development

## Project Overview

Agila is a full-stack Kanban board application with:
- **Backend**: Express.js with JWT authentication
- **Frontend**: React + TypeScript with Vite
- **Databases**: PostgreSQL only (all editions)
- **Real-time**: PostgreSQL LISTEN/NOTIFY for app events; Redis for Socket.IO adapter
- **Architecture**: Single-tenant (Docker) or multi-tenant (Kubernetes) deployment modes

## Core Architecture Patterns

### 1. Database Abstraction (sqlManager)

**CRITICAL**: Never write raw SQL in routes. Always use sqlManager.

```javascript
// ✅ CORRECT - Use sqlManager
import { tasks as taskQueries } from '../utils/sqlManager/index.js';

const task = await taskQueries.getTaskById(db, taskId);
await taskQueries.updateTask(db, taskId, { title: 'New Title' });

// ❌ WRONG - No raw SQL in routes
const task = await db.prepare('SELECT * FROM tasks WHERE id = $1').get(taskId);
```

**Location**: `server/utils/sqlManager/[domain].js`

Each domain file exports PostgreSQL query functions (`$1` placeholders).

### 2. Multi-Tenant Database Access

Always get the database instance from the request:

```javascript
import { getRequestDatabase } from '../middleware/tenantRouting.js';

router.get('/api/tasks', authenticateToken, async (req, res) => {
  const db = getRequestDatabase(req);  // Gets tenant-specific database
  const tasks = await taskQueries.getAllTasks(db);
  res.json(tasks);
});
```

### 3. Authentication & Authorization

```javascript
import { authenticateToken, requireRole } from '../middleware/auth.js';

// Public route - no auth
router.post('/api/auth/login', async (req, res) => { ... });

// Protected route - requires valid JWT
router.get('/api/tasks', authenticateToken, async (req, res) => { ... });

// Admin-only route
router.delete('/api/admin/users/:id', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => { ... }
);
```

**Public routes** are explicitly listed in AGENTS.md. All other routes MUST use `authenticateToken`.

**Media files (avatars, attachments):** browser `<img>` / downloads use HttpOnly cookie `ek_media` (`purpose: media` JWT) from `POST /api/files/media-session`. Do **not** put the session JWT in `?token=`. PATs (`ek_…`) authenticate JSON APIs via `Authorization: Bearer`; they do not replace the media cookie for same-origin image loads. Inactive / `force_logout` users fail media and WebSocket auth (`userMayUseSession`).

**JSON body validation:** use Zod `parseBody` from `server/utils/requestValidation.js` on write routes. Multipart uploads stay on multer + magic-byte checks.

### 4. Real-Time Updates

Publish events after database changes:

```javascript
import notificationService from '../services/notificationService.js';
import { getTenantId } from '../middleware/tenantRouting.js';

// After creating/updating a task
await taskQueries.createTask(db, taskData);

const tenantId = getTenantId(req);
await notificationService.publish('task-created', {
  task: taskData,
  timestamp: new Date().toISOString()
}, tenantId);
```

**Common event types**: `task-created`, `task-updated`, `task-deleted`, `board-updated`, `member-updated`, `settings-updated`, `user-updated`

## Common Workflows

### Adding a New API Endpoint

**Checklist:**
```
- [ ] Create route handler in appropriate file (server/routes/*.js)
- [ ] Add authenticateToken middleware (unless explicitly public)
- [ ] Use getRequestDatabase(req) to get database instance
- [ ] Use sqlManager queries (never raw SQL)
- [ ] Add real-time event publishing if data changes
- [ ] Apply rate limiting for sensitive operations
- [ ] Handle errors without exposing stack traces
- [ ] Validate JSON bodies with Zod `parseBody` when adding write routes
- [ ] Test against PostgreSQL (the only supported database)
```

**Example:**
```javascript
// server/routes/tasks.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import { tasks as taskQueries } from '../utils/sqlManager/index.js';
import notificationService from '../services/notificationService.js';
import { parseBody, createTaskBodySchema } from '../utils/requestValidation.js';

const router = express.Router();

router.post('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(createTaskBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { title, description, boardId } = parsed.data;
    
    // Create task via sqlManager
    const taskId = crypto.randomUUID();
    await taskQueries.createTask(db, {
      id: taskId,
      title,
      description,
      board_id: boardId,
      created_by: req.user.id
    });
    
    const task = await taskQueries.getTaskById(db, taskId);
    
    // Publish real-time event
    const tenantId = getTenantId(req);
    await notificationService.publish('task-created', {
      task,
      timestamp: new Date().toISOString()
    }, tenantId);
    
    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

export default router;
```

### Creating a Database Migration

**Location**: `server/migrations/index.js`

**Checklist:**
```
- [ ] Add migration to MIGRATIONS array in chronological order
- [ ] Use PostgreSQL DDL only (`$1` placeholders / PG types)
- [ ] Use parameterized queries for data operations
- [ ] Test rollback if provided
- [ ] Update version number
```

**Example:**
```javascript
// In server/migrations/index.js
{
  version: 42,
  name: 'add_task_priority_column',
  up: async (db) => {
    await dbExec(db, `
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium';
    `);
    console.log('✅ Migration 42: Added priority column to tasks');
  },
  down: async (db) => {
    await dbExec(db, 'ALTER TABLE tasks DROP COLUMN IF EXISTS priority;');
  }
}
```

### Adding sqlManager Queries

**Location**: `server/utils/sqlManager/[domain].js`

**Pattern:**
```javascript
// server/utils/sqlManager/tasks.js
import { wrapQuery } from '../queryLogger.js';
import { isPostgresDatabase } from '../dbAsync.js';

export const tasks = {
  // Get single task
  getTaskById: async (db, taskId) => {
    const isPostgres = isPostgresDatabase(db);
    const query = isPostgres
      ? 'SELECT * FROM tasks WHERE id = $1'
      : 'SELECT * FROM tasks WHERE id = ?';
    
    const result = await wrapQuery(
      db.prepare(query),
      'SELECT'
    ).get(taskId);
    
    return result ? camelCaseKeys(result) : null;
  },
  
  // Update task
  updateTask: async (db, taskId, updates) => {
    const isPostgres = isPostgresDatabase(db);
    const timestamp = isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";
    
    const query = isPostgres
      ? `UPDATE tasks SET title = $1, updated_at = ${timestamp} WHERE id = $2`
      : `UPDATE tasks SET title = ?, updated_at = ${timestamp} WHERE id = ?`;
    
    await wrapQuery(
      db.prepare(query),
      'UPDATE'
    ).run(updates.title, taskId);
  }
};
```

**Helper function** (include in the same file):
```javascript
// Convert snake_case to camelCase for consistent API responses
function camelCaseKeys(obj) {
  if (!obj) return obj;
  const result = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result;
}
```

### Handling Rate Limiting

**Location**: `server/middleware/rateLimiters.js`

```javascript
import rateLimit from 'express-rate-limit';

// Create custom rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to routes
router.post('/api/sensitive-action', apiLimiter, authenticateToken, async (req, res) => {
  // ...
});
```

**Existing limiters**: `loginLimiter`, `passwordResetLimiter`, `registrationLimiter`, `activationLimiter`, `adminPortalRateLimit`

## Database Transaction Pattern

For multi-step operations that must succeed or fail together:

```javascript
import { dbTransaction, isProxyDatabase } from '../utils/dbAsync.js';

if (isProxyDatabase(db)) {
  // Proxy mode (multi-tenant): Batch queries
  const batchQueries = [
    { query: 'UPDATE tasks SET ...', params: [...] },
    { query: 'INSERT INTO activity ...', params: [...] }
  ];
  await db.executeBatchTransaction(batchQueries);
} else {
  // Direct DB mode: Standard transaction
  await dbTransaction(db, async () => {
    await taskQueries.updateTask(db, taskId, updates);
    await activityQueries.logActivity(db, 'task_updated', ...);
  });
}
```

## Frontend Integration

### API Calls

```typescript
// src/api/tasks.ts
import axios from 'axios';

const API_URL = '/api';

export const createTask = async (taskData: CreateTaskData) => {
  const response = await axios.post(`${API_URL}/tasks`, taskData, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    }
  });
  return response.data;
};
```

### WebSocket Listeners

```typescript
// In React component
import { useEffect } from 'react';
import { socket } from '../socket';

useEffect(() => {
  socket.on('task-created', (data) => {
    // Update state with new task
    setTasks(prev => [...prev, data.task]);
  });
  
  return () => {
    socket.off('task-created');
  };
}, []);
```

## Testing Considerations

### Multi-Tenant Isolation

When testing multi-tenant features:
1. Verify users can only access their tenant's data
2. Test tenant ID extraction from hostname
3. Confirm JWT tokens are validated against tenant database

### Database Compatibility

PostgreSQL is the only supported database (Docker and Kubernetes). Use `$1` placeholders, boolean `true`/`false`, and `CURRENT_TIMESTAMP` / `::text` casts for date fields exposed to the UI.

## Security Checklist

Before merging code, verify:

- [ ] All routes use `authenticateToken` (unless explicitly public)
- [ ] Multi-tenant isolation: `getRequestDatabase(req)` used correctly
- [ ] No raw SQL in routes (sqlManager only)
- [ ] Parameterized queries (no SQL injection)
- [ ] JSON writes use Zod `parseBody` where applicable
- [ ] No error stack traces exposed to clients
- [ ] Rate limiting applied to sensitive endpoints
- [ ] JWT tokens contain minimal user info (id, email, role only)
- [ ] File uploads validated (size, mime type, extension, magic bytes)
- [ ] Media URLs do not embed the session JWT in `?token=`

## File Structure Reference

```
server/
├── routes/           # API route handlers
├── middleware/       # Auth, rate limiting, tenant routing
├── utils/
│   └── sqlManager/   # Database query abstraction
├── services/         # Email, notifications, WebSocket
├── migrations/       # Database schema changes
└── config/           # Database, license, multer config

src/                  # React frontend
├── components/       # UI components
├── api/              # API client functions
├── hooks/            # React hooks
└── types/            # TypeScript types
```

## Help Assistant UI index

Locatable Help/chat targets are **harvested**, not hand-listed in EN/FR:

- Hooks: `data-setting-key`, `data-tour-id`, `data-help-target`, `data-owner-setup`
- Generate: `npm run help:ui-index` → `server/config/helpUiIndex.generated.json`
- CI: `npm run help:ui-index:check` (must commit the generated file)
- Facts only (behavior labels get wrong): `server/config/helpAssistantFacts.js`

Each chat request retrieves a **small slice** of the index; the full file is not sent to the model.


- **Public Routes List**: See AGENTS.md for complete list of unauthenticated routes
- **Authentication Flow**: `server/middleware/auth.js` and `server/routes/auth.js`
- **Migration System**: `server/migrations/index.js`
- **Real-Time Events**: `server/services/notificationService.js`
- **Multi-Tenant Setup**: `server/middleware/tenantRouting.js`
