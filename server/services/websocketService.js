import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import redisService from './redisService.js';
import postgresNotificationService from './postgresNotificationService.js';
import { JWT_SECRET, isUserActive, userMayUseSession } from '../middleware/auth.js';
import { extractTenantId, getTenantDatabase } from '../middleware/tenantRouting.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { wsVerboseLog } from '../utils/serverDebug.js';
import { getTenantDomain } from '../utils/tenantDomain.js';

function userSocketRoom(tenantId, userId) {
  return tenantId ? `user-${tenantId}-${userId}` : `user-${userId}`;
}

class WebSocketService {
  constructor() {
    this.io = null;
    this.connectedClients = new Map();
    this.redisPubClient = null;
    this.redisSubClient = null;
  }

  async initialize(server) {
    // CORS configuration for WebSocket
    // Multi-tenant: allow tenant subdomains of TENANT_DOMAIN (+ optional ALLOWED_ORIGINS).
    // Single-tenant: ALLOWED_ORIGINS if set, otherwise reflect request origin (dev-friendly).
    const allowedOriginsEnv = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const tenantDomain = getTenantDomain();

    const allowedOrigins =
      process.env.MULTI_TENANT === 'true'
        ? (origin, callback) => {
            if (!origin) {
              return callback(null, true);
            }
            if (allowedOriginsEnv.includes(origin)) {
              return callback(null, true);
            }
            try {
              const host = new URL(origin).hostname;
              if (host === tenantDomain || host.endsWith(`.${tenantDomain}`)) {
                return callback(null, true);
              }
            } catch {
              /* invalid origin */
            }
            console.warn(`⚠️ Socket.IO CORS rejected origin: ${origin}`);
            return callback(new Error('Not allowed by CORS'));
          }
        : (allowedOriginsEnv.length > 0 ? allowedOriginsEnv : true);
    
    this.io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: 60000, // 60 seconds - how long to wait for pong before closing
      pingInterval: 25000, // 25 seconds - how often to ping
      upgradeTimeout: 30000, // 30 seconds - time to wait for upgrade
      transports: ['polling', 'websocket'], // Try polling first for better compatibility
      allowEIO3: true, // Allow Engine.IO v3 clients
      // Add error handling for Socket.IO requests
      allowRequest: (req, callback) => {
        // Verbose only — per-handshake host logging is noisy in production
        if (process.env.MULTI_TENANT === 'true') {
          const hostname = req.headers.host || req.headers['x-forwarded-host'] || '';
          const tenantId = extractTenantId(hostname);
          wsVerboseLog(`🔍 Socket.IO request - Host: ${req.headers.host}, X-Forwarded-Host: ${req.headers['x-forwarded-host']}, Tenant: ${tenantId || 'none'}`);
        }
        callback(null, true); // Allow all requests (authentication happens in middleware)
      }
    });

    // Configure Redis adapter for Socket.IO to share sessions across multiple pods
    // This is critical for multi-pod deployments where load balancing can route
    // Socket.IO polling requests to different pods than where the session was created
    // 
    // Only use Redis adapter when:
    // 1. Multi-tenant mode is enabled (always needs adapter for pod scaling)
    // 2. Explicitly enabled via USE_REDIS_ADAPTER env var (for multi-pod single-tenant deployments)
    // 
    // In single-tenant Docker with single instance, use in-memory adapter (faster, simpler)
    const useRedisAdapter = process.env.MULTI_TENANT === 'true' || process.env.USE_REDIS_ADAPTER === 'true';
    
    if (useRedisAdapter) {
      try {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        
        // Create separate Redis clients for Socket.IO adapter (pub/sub pattern)
        this.redisPubClient = createClient({ url: redisUrl });
        this.redisSubClient = this.redisPubClient.duplicate();
        
        await Promise.all([
          this.redisPubClient.connect(),
          this.redisSubClient.connect()
        ]);
        
        // Set up the Redis adapter
        // Note: The adapter automatically handles session storage in Redis
        // Sessions are stored with keys like "socket.io#/#" prefix
        const adapter = createAdapter(this.redisPubClient, this.redisSubClient);
        this.io.adapter(adapter);
        console.log('✅ Socket.IO Redis adapter configured - sessions will be shared across all pods');
        console.log('   Redis URL:', redisUrl);
        console.log('   Adapter type:', adapter.constructor.name);
        console.log('   Mode:', process.env.MULTI_TENANT === 'true' ? 'multi-tenant' : 'multi-pod single-tenant');
      } catch (error) {
        console.error('❌ Failed to configure Socket.IO Redis adapter:', error);
        console.warn('⚠️ Socket.IO will use in-memory adapter (sessions not shared across pods)');
        // Continue without Redis adapter - Socket.IO will use default in-memory adapter
        // This is acceptable for single-pod deployments but will cause issues with multiple pods
      }
    } else {
      console.log('ℹ️ Socket.IO using in-memory adapter (single-instance mode)');
      console.log('   Redis is still used for pub/sub messaging (real-time updates)');
      console.log('   To enable Redis adapter for multi-pod deployments, set USE_REDIS_ADAPTER=true');
    }
    
    
    // Add authentication middleware
    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        console.log('❌ WebSocket auth failed: No token provided');
        return next(new Error('Authentication required'));
      }
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Extract tenant ID from hostname (for multi-tenant isolation)
        const hostname = socket.handshake.headers.host || socket.handshake.headers['x-forwarded-host'] || '';
        const tenantId = extractTenantId(hostname);
        
        // Always verify user still exists (demo resets wipe users while JWTs remain cryptographically valid)
        try {
          let db = null;
          if (process.env.MULTI_TENANT === 'true') {
            if (!tenantId) {
              console.warn(`⚠️ WebSocket auth: Multi-tenant mode but no tenant ID extracted from hostname: ${hostname}`);
              return next(new Error('Authentication failed'));
            }
            const dbInfo = await getTenantDatabase(tenantId);
            db = dbInfo?.db || null;
          } else {
            const dbInfo = await getTenantDatabase(null);
            db = dbInfo?.db || null;
          }

          if (!db) {
            console.warn('⚠️ WebSocket auth: Could not get database for user validation');
            return next(new Error('Authentication failed'));
          }

          const userInDb = await wrapQuery(
            db.prepare('SELECT id, email, is_active, force_logout FROM users WHERE id = ?'),
            'SELECT'
          ).get(decoded.id);
          if (!userInDb) {
            console.log(`❌ WebSocket auth failed: User ${decoded.email} (${decoded.id}) does not exist in database`);
            return next(new Error('Invalid token'));
          }
          if (!userMayUseSession(userInDb)) {
            const reason = !isUserActive(userInDb.is_active) ? 'inactive' : 'force_logout';
            console.log(`❌ WebSocket auth failed: User ${userInDb.email} (${userInDb.id}) is ${reason}`);
            return next(new Error('Invalid token'));
          }
        } catch (dbError) {
          console.error('❌ Error checking user in database for WebSocket:', dbError);
          return next(new Error('Authentication failed'));
        }
        
        // Attach user info to socket
        socket.userId = decoded.id;
        socket.userEmail = decoded.email;
        socket.userRole = decoded.role;
        socket.userRoles = decoded.roles;
        socket.tenantId = tenantId; // Store tenantId for room isolation
        // Per-user room so we can disconnect on deactivate/delete (works across pods with Redis adapter)
        socket.join(userSocketRoom(tenantId, decoded.id));
        
        console.log('✅ WebSocket authenticated:', decoded.email, tenantId ? `(tenant: ${tenantId})` : '');
        next();
      } catch (err) {
        console.log('❌ WebSocket auth failed:', err.message);
        return next(new Error('Invalid token'));
      }
    });
    

    // Handle connection errors
    this.io.engine.on('connection_error', (err) => {
      console.error('❌ Socket.IO connection error:', err);
      console.error('❌ Error details:', err.message, err.context);
    });

    // Handle connections
    this.io.on('connection', (socket) => {
      // Always log successful connections (ops signal that WS is up)
      console.log(`🔌 Client connected: ${socket.id} (${socket.userEmail})`);
      if (socket.tenantId) {
        console.log(`   📍 Tenant context: ${socket.tenantId}`);
      }
      
      this.connectedClients.set(socket.id, { 
        socketId: socket.id, 
        userId: socket.userId,
        userEmail: socket.userEmail,
        userRole: socket.userRole,
        tenantId: socket.tenantId
      });

      // Join tenant namespace (for tenant-wide broadcasts in multi-tenant mode)
      if (socket.tenantId) {
        socket.join(`tenant-${socket.tenantId}`);
      }

      // Join board room (tenant-aware in multi-tenant mode)
      socket.on('join-board', (boardId) => {
        const timestamp = new Date().toISOString();
        // Use tenant-prefixed room in multi-tenant mode
        const room = socket.tenantId 
          ? `tenant-${socket.tenantId}-board-${boardId}`
          : `board-${boardId}`;
        
        wsVerboseLog(`📋 [${timestamp}] Client ${socket.id} (${socket.userEmail}) joining board room: ${room}`);
        
        // For now, allow all authenticated users to join any board
        // TODO: Add proper board access control based on user permissions
        socket.join(room);
        this.connectedClients.set(socket.id, { 
          socketId: socket.id, 
          userId: socket.userId,
          userEmail: socket.userEmail,
          userRole: socket.userRole,
          tenantId: socket.tenantId,
          boardId 
        });
        
        // Check how many clients are now in the room
        const clientsInRoom = this.io.sockets.adapter.rooms.get(room)?.size || 0;
        wsVerboseLog(`✅ [${timestamp}] Client joined room ${room}. Total clients in room: ${clientsInRoom}`);
        
        // Send confirmation back to client
        socket.emit('joined-room', { boardId, room });
      });

      // Leave board room (tenant-aware in multi-tenant mode)
      socket.on('leave-board', (boardId) => {
        const room = socket.tenantId 
          ? `tenant-${socket.tenantId}-board-${boardId}`
          : `board-${boardId}`;
        socket.leave(room);
        this.connectedClients.set(socket.id, { 
          socketId: socket.id, 
          userId: socket.userId,
          userEmail: socket.userEmail,
          userRole: socket.userRole,
          tenantId: socket.tenantId
        });
      });

      // Handle user activity (tenant-aware in multi-tenant mode)
      socket.on('user-activity', (data) => {
        // Broadcast user activity to other clients on the same board
        const client = this.connectedClients.get(socket.id);
        if (client?.boardId) {
          const room = client.tenantId 
            ? `tenant-${client.tenantId}-board-${client.boardId}`
            : `board-${client.boardId}`;
          socket.to(room).emit('user-activity', {
            ...data,
            socketId: socket.id,
            userId: socket.userId,
            userEmail: socket.userEmail
          });
        }
      });

      socket.on('disconnect', (reason) => {
        wsVerboseLog(`🔴 Client disconnected: ${socket.id} (${socket.userEmail}) - Reason: ${reason}`);
        this.connectedClients.delete(socket.id);
      });

      socket.on('error', (error) => {
        console.error(`❌ Socket error for ${socket.id}:`, error.message);
      });
    });

    // Subscribe to notification channels via PostgreSQL LISTEN/NOTIFY
    console.log('🔧 Setting up PostgreSQL notification subscriptions');
    this.setupPostgresSubscriptions();
  }

  // Get tenant-prefixed room name (for multi-tenant isolation)
  getTenantRoom(roomBase, tenantId, boardId) {
    if (tenantId && process.env.MULTI_TENANT === 'true') {
      return `tenant-${tenantId}-${roomBase}-${boardId}`;
    }
    return `${roomBase}-${boardId}`;
  }

  /**
   * Setup PostgreSQL LISTEN subscriptions
   * Uses the same callback pattern as Redis subscriptions for easy replacement
   */
  setupPostgresSubscriptions() {
    console.log('🔧 Setting up PostgreSQL subscriptions...');
    // In multi-tenant mode, subscribe to all tenant channels
    // In single-tenant mode, subscribe to base channels
    
    // Task updates - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('task-updated', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      const connectedCount = this.io?.sockets?.sockets?.size || 0;
      wsVerboseLog(`📡 [${timestamp}] WebSocket received task-updated (tenant: ${tenantId || 'single'}, connected clients: ${connectedCount})`);
      
      if (tenantId) {
        // Multi-tenant: broadcast only to clients of this tenant
        this.io?.to(`tenant-${tenantId}`).emit('task-updated', data);
        wsVerboseLog(`   ✅ Broadcasted to tenant-${tenantId} room`);
      } else {
        // Single-tenant: broadcast to all clients
        this.io?.emit('task-updated', data);
        wsVerboseLog(`   ✅ Broadcasted to all ${connectedCount} connected clients`);
      }
    });

    // Task created - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('task-created', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket received task-created (tenant: ${tenantId || 'single'})`);
      
      if (tenantId) {
        // Multi-tenant: broadcast only to clients of this tenant
        this.io?.to(`tenant-${tenantId}`).emit('task-created', data);
      } else {
        // Single-tenant: broadcast to all clients
        this.io?.emit('task-created', data);
      }
    });

    // Agent task_work updates (status / log / control)
    postgresNotificationService.subscribeToAllTenants('task-work-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('task-work-updated', data);
      } else {
        this.io?.emit('task-work-updated', data);
      }
    });

    // Task deleted - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('task-deleted', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket broadcasting task-deleted (tenant: ${tenantId || 'single'})`);
      
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('task-deleted', data);
      } else {
        this.io?.emit('task-deleted', data);
      }
    });

    // Soft-deleted task restored to live board
    postgresNotificationService.subscribeToAllTenants('task-restored', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket broadcasting task-restored (tenant: ${tenantId || 'single'})`);

      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('task-restored', data);
      } else {
        this.io?.emit('task-restored', data);
      }
    });

    // Soft-deleted task permanently purged from trash
    postgresNotificationService.subscribeToAllTenants('task-purged', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket broadcasting task-purged (tenant: ${tenantId || 'single'})`);

      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('task-purged', data);
      } else {
        this.io?.emit('task-purged', data);
      }
    });

    // Soft-deleted board restored
    postgresNotificationService.subscribeToAllTenants('board-restored', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket broadcasting board-restored (tenant: ${tenantId || 'single'})`);

      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('board-restored', data);
      } else {
        this.io?.emit('board-restored', data);
      }
    });

    // Full-column position sync (add-at-top, delete renumber, etc.)
    postgresNotificationService.subscribeToAllTenants('tasks-positions-updated', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket broadcasting tasks-positions-updated (tenant: ${tenantId || 'single'}, updates: ${data?.updates?.length || 0})`);
      
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('tasks-positions-updated', data);
      } else {
        this.io?.emit('tasks-positions-updated', data);
      }
    });

    // Task relationship created - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('task-relationship-created', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-relationship-created', data);
    });

    // Task relationship deleted - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('task-relationship-deleted', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-relationship-deleted', data);
    });

    // Board created - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('board-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('board-created', data);
      } else {
        this.io?.emit('board-created', data);
      }
    });

    // Board updates - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('board-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('board-updated', data);
      } else {
        this.io?.emit('board-updated', data);
      }
    });

    // Board deleted - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('board-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('board-deleted', data);
      } else {
        this.io?.emit('board-deleted', data);
      }
    });

    // Board reordered - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('board-reordered', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('board-reordered', data);
      } else {
        this.io?.emit('board-reordered', data);
      }
    });

    // Column updates - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('column-updated', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('column-updated', data);
    });

    // Column created - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('column-created', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('column-created', data);
    });

    // Column deleted - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('column-deleted', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('column-deleted', data);
    });

    // Column reordered - broadcast to tenant-specific board room
    // Column reordered - broadcast to ALL tenant clients (not just board room)
    // CRITICAL: Column order affects boards state even when board is not currently viewed
    // Users need to receive this update in the background to keep boards state in sync
    postgresNotificationService.subscribeToAllTenants('column-reordered', (data, tenantId) => {
      if (tenantId) {
        // Multi-tenant: broadcast to all clients of this tenant
        this.io?.to(`tenant-${tenantId}`).emit('column-reordered', data);
      } else {
        // Single-tenant: broadcast to all clients
        this.io?.emit('column-reordered', data);
      }
    });

    // Member updates - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('member-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('member-updated', data);
      } else {
        this.io?.emit('member-updated', data);
      }
    });

    // Activity updates - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('activity-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('activity-updated', data);
      } else {
        this.io?.emit('activity-updated', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('notification-queue-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('notification-queue-updated', data);
      } else {
        this.io?.emit('notification-queue-updated', data);
      }
    });

    // Admin user management events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('user-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('user-created', data);
      } else {
        this.io?.emit('user-created', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('user-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('user-updated', data);
      } else {
        this.io?.emit('user-updated', data);
      }
      // S6: drop live sockets immediately when an admin deactivates the user
      const user = data?.user;
      if (user?.id && user.isActive === false) {
        this.disconnectUserSockets(user.id, tenantId);
      }
    });

    postgresNotificationService.subscribeToAllTenants('user-role-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('user-role-updated', data);
      } else {
        this.io?.emit('user-role-updated', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('user-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('user-deleted', data);
      } else {
        this.io?.emit('user-deleted', data);
      }
      const userId = data?.user?.id || data?.userId;
      if (userId) {
        this.disconnectUserSockets(userId, tenantId);
      }
    });

    // Admin settings events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('settings-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('settings-updated', data);
      } else {
        this.io?.emit('settings-updated', data);
      }
    });

    // Task watcher updates - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('task-watcher-added', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-watcher-added', data);
    });

    postgresNotificationService.subscribeToAllTenants('task-watcher-removed', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-watcher-removed', data);
    });

    // Task collaborator updates - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('task-collaborator-added', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-collaborator-added', data);
    });

    postgresNotificationService.subscribeToAllTenants('task-collaborator-removed', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-collaborator-removed', data);
    });

    // Member updates - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('member-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('member-created', data);
      } else {
        this.io?.emit('member-created', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('member-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('member-deleted', data);
      } else {
        this.io?.emit('member-deleted', data);
      }
    });

    // Filter events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('filter-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('filter-created', data);
      } else {
        this.io?.emit('filter-created', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('filter-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('filter-updated', data);
      } else {
        this.io?.emit('filter-updated', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('filter-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('filter-deleted', data);
      } else {
        this.io?.emit('filter-deleted', data);
      }
    });

    // Comment events - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('comment-created', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('comment-created', data);
    });

    postgresNotificationService.subscribeToAllTenants('comment-updated', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('comment-updated', data);
    });

    postgresNotificationService.subscribeToAllTenants('comment-deleted', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('comment-deleted', data);
    });

    // Attachment events - broadcast to tenant-specific board room
    postgresNotificationService.subscribeToAllTenants('attachment-created', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('attachment-created', data);
    });

    postgresNotificationService.subscribeToAllTenants('attachment-deleted', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('attachment-deleted', data);
    });

    // User profile events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('user-profile-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('user-profile-updated', data);
      } else {
        this.io?.emit('user-profile-updated', data);
      }
    });

    // Tag management events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('tag-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('tag-created', data);
      } else {
        this.io?.emit('tag-created', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('tag-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('tag-updated', data);
      } else {
        this.io?.emit('tag-updated', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('tag-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('tag-deleted', data);
      } else {
        this.io?.emit('tag-deleted', data);
      }
    });

    // Priority management events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('priority-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('priority-created', data);
      } else {
        this.io?.emit('priority-created', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('priority-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('priority-updated', data);
      } else {
        this.io?.emit('priority-updated', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('priority-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('priority-deleted', data);
      } else {
        this.io?.emit('priority-deleted', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('priority-reordered', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('priority-reordered', data);
      } else {
        this.io?.emit('priority-reordered', data);
      }
    });

    // Sprint management events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('sprint-created', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('sprint-created', data);
      } else {
        this.io?.emit('sprint-created', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('sprint-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('sprint-updated', data);
      } else {
        this.io?.emit('sprint-updated', data);
      }
    });

    postgresNotificationService.subscribeToAllTenants('sprint-deleted', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('sprint-deleted', data);
      } else {
        this.io?.emit('sprint-deleted', data);
      }
    });

    // Task tag events - broadcast to tenant-specific board room
    wsVerboseLog('🔧 Registering subscription for task-tag-added');
    postgresNotificationService.subscribeToAllTenants('task-tag-added', (data, tenantId) => {
      const timestamp = new Date().toISOString();
      wsVerboseLog(`📡 [${timestamp}] WebSocket received task-tag-added (tenant: ${tenantId || 'single'})`, {
        taskId: data.taskId,
        tagId: data.tagId,
        boardId: data.boardId,
        tag: data.tag
      });
      
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      
      // Get client count in room for debugging
      const roomClients = this.io?.sockets.adapter.rooms.get(room);
      const clientCount = roomClients ? roomClients.size : 0;
      
      wsVerboseLog(`📤 [${timestamp}] Broadcasting task-tag-added to room: ${room} (${clientCount} clients)`);
      this.io?.to(room).emit('task-tag-added', data);
      wsVerboseLog(`✅ [${timestamp}] task-tag-added broadcast complete to ${clientCount} clients`);
    });

    postgresNotificationService.subscribeToAllTenants('task-tag-removed', (data, tenantId) => {
      const room = tenantId 
        ? `tenant-${tenantId}-board-${data.boardId}`
        : `board-${data.boardId}`;
      this.io?.to(room).emit('task-tag-removed', data);
    });

    // Instance status updates - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('instance-status-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('instance-status-updated', data);
      } else {
        this.io?.emit('instance-status-updated', data);
      }
    });

    // Version update events - broadcast to tenant-specific clients
    postgresNotificationService.subscribeToAllTenants('version-updated', (data, tenantId) => {
      if (tenantId) {
        this.io?.to(`tenant-${tenantId}`).emit('version-updated', data);
      } else {
        this.io?.emit('version-updated', data);
      }
    });
  }

  /**
   * Force-disconnect all sockets for a user (S6 — deactivate / delete).
   * Relies on per-user rooms joined at handshake; Redis adapter fans out across pods.
   */
  disconnectUserSockets(userId, tenantId = null) {
    if (!this.io || !userId) return;
    const room = userSocketRoom(tenantId, userId);
    console.log(`🔌 Disconnecting sockets for user ${userId}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
    this.io.in(room).disconnectSockets(true);
  }

  getConnectedClients() {
    return Array.from(this.connectedClients.values());
  }

  getClientCount() {
    return this.connectedClients.size;
  }

  getBoardClientCount(boardId) {
    return Array.from(this.connectedClients.values()).filter(client => client.boardId === boardId).length;
  }

  // Cleanup: Disconnect Redis adapter clients (for graceful shutdown)
  async disconnect() {
    try {
      // Close Socket.IO server
      if (this.io) {
        this.io.close();
        console.log('✅ Socket.IO server closed');
      }

      // Disconnect Redis adapter clients
      if (this.redisPubClient) {
        await this.redisPubClient.disconnect();
        console.log('✅ Socket.IO Redis pub client disconnected');
      }
      
      if (this.redisSubClient) {
        await this.redisSubClient.disconnect();
        console.log('✅ Socket.IO Redis sub client disconnected');
      }

      this.connectedClients.clear();
    } catch (error) {
      console.error('❌ Error disconnecting WebSocket service:', error);
    }
  }
}

export default new WebSocketService();
