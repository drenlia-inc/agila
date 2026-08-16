import { io, Socket } from 'socket.io-client';
import { handleAuthError } from '../utils/authErrorHandler';
import { feDebug } from '../utils/clientDebug';
import { prepareRealtimeSocketArgs } from '../utils/realtimeDedupe';

function wsDebug(...args: unknown[]) {
  if (feDebug('FE_DEBUG_WEBSOCKET')) console.log(...args);
}

class WebSocketClient {
  private socket: Socket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private readyCallbacks: (() => void)[] = [];
  private eventCallbacks: Map<string, Function[]> = new Map();
  /** Events that already have a single Socket.IO dispatcher (fans out to all callbacks). */
  private socketDispatchBound: Set<string> = new Set();
  private pendingBoardJoin: string | null = null; // Store board to join when ready

  /**
   * Detects if we're in multi-tenant mode.
   * Uses the MULTI_TENANT environment variable injected at build time.
   */
  private isMultiTenantMode(): boolean {
    // Use the MULTI_TENANT env var injected at build time via Vite
    // This matches the server-side process.env.MULTI_TENANT
    const multiTenant = (process.env.MULTI_TENANT as string) === 'true';
    return multiTenant;
  }

  connect() {
    if (this.socket?.connected) {
      return;
    }

    // Get authentication token
    const token = localStorage.getItem('authToken');
    if (!token) {
      return;
    }

    // Check if we're on any auth-related page (login, password reset, etc.)
    const hash = window.location.hash.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    if (hash === '#login' || hash.includes('login') || 
        hash.includes('forgot-password') || hash.includes('reset-password') ||
        hash.includes('activate-account') ||
        pathname.includes('login') || pathname.includes('forgot-password') || 
        pathname.includes('reset-password') || pathname.includes('activate-account')) {
      return;
    }

    // Validate token before connecting - make a test API call
    this.validateTokenAndConnect(token);
  }

  private async validateTokenAndConnect(token: string) {
    try {
      // Make a simple API call to validate the token
      // Use /api/auth/me which exists and requires authentication
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`⚠️ [WebSocket] Token validation failed (status: ${response.status}), attempting connection anyway`);
        // Still try to connect - the WebSocket server will validate the token
        this.establishConnection(token);
        return;
      }

      wsDebug('✅ [WebSocket] Token validated, establishing connection');
      this.establishConnection(token);
    } catch (error) {
      console.warn(`⚠️ [WebSocket] Token validation error, attempting connection anyway:`, error);
      // Still try to connect - the WebSocket server will validate the token
      this.establishConnection(token);
    }
  }

  private establishConnection(token: string) {
    // Disconnect any existing socket to ensure fresh connection with new token
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    // Use the same URL as the frontend - the frontend will proxy WebSocket connections to the backend
    const serverUrl = window.location.origin;

    // Determine transport strategy based on deployment mode
    // Multi-tenant: Use websocket ONLY (Redis adapter handles session sharing across pods)
    //   - MUST use websocket only to avoid session ID issues with load balancing
    //   - Polling transport requires sticky sessions which are complex to configure
    // Single-tenant: Use polling + websocket (more reliable through proxies, no session issues)
    const isMultiTenant = this.isMultiTenantMode();
    const transports = isMultiTenant 
      ? ['websocket'] // Multi-tenant: websocket ONLY - no polling fallback
      : ['polling', 'websocket']; // Single-tenant: polling first, then upgrade to websocket

    wsDebug(`🔌 WebSocket transport config: ${isMultiTenant ? 'multi-tenant' : 'single-tenant'} mode, using transports: [${transports.join(', ')}]`);

    // Socket.IO options - in multi-tenant mode, enforce websocket-only strictly
    const socketOptions: any = {
      auth: { token }, // Add authentication token
      transports,
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      forceNew: true, // Force a new connection
    };

    // In multi-tenant mode, prevent any transport upgrades/fallbacks
    // This ensures we NEVER use polling transport in multi-tenant deployments
    if (isMultiTenant) {
      socketOptions.upgrade = false; // Disable transport upgrades (prevents fallback to polling)
      socketOptions.rememberUpgrade = false; // Don't remember previous transport
    }

    this.socket = io(serverUrl, socketOptions);

    this.socket.on('connect', () => {
      // Validate transport in multi-tenant mode - must be websocket
      if (isMultiTenant && this.socket?.io?.engine?.transport?.name !== 'websocket') {
        console.error('❌ CRITICAL: Multi-tenant mode detected polling transport! Disconnecting...');
        this.socket.disconnect();
        this.isConnected = false;
        return;
      }
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000; // Reset delay
      
      wsDebug(`✅ WebSocket connected (transport: ${this.socket?.io?.engine?.transport?.name || 'unknown'})`);
      
      // Re-register all event listeners
      this.reregisterEventListeners();
      
      // Add a general event listener to debug all events
      if (this.socket) {
        this.socket.onAny((eventName, ...args) => {
          // Log all events for debugging
          if (eventName.includes('tag')) {
            wsDebug('🔍 [WebSocket] Received event:', eventName, 'with data:', args);
          }
        });
      }
      
      // Trigger ready callbacks directly
      this.readyCallbacks.forEach((callback, index) => {
        callback();
      });
      
      // Handle pending board join
      if (this.pendingBoardJoin) {
        this.joinBoard(this.pendingBoardJoin);
        this.pendingBoardJoin = null;
      }
      
      // Trigger custom connect callbacks
      const connectCallbacks = this.eventCallbacks.get('connect') || [];
      connectCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('Error in connect callback:', error);
        }
      });
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      
      // Trigger custom disconnect callbacks
      const disconnectCallbacks = this.eventCallbacks.get('disconnect') || [];
      disconnectCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('Error in disconnect callback:', error);
        }
      });
    });

    this.socket.on('connect_error', (error) => {
      // Suppress errors during page unload/refresh - these are expected
      const readyState = document.readyState as string;
      if (readyState === 'unloading' || readyState === 'loading') {
        return;
      }
      
      // Suppress "WebSocket is closed before the connection is established" errors
      // This is common during page refreshes when Socket.IO is upgrading from polling to websocket
      if (error.message && error.message.includes('WebSocket is closed before the connection is established')) {
        return;
      }
      
      // Suppress timeout errors - these are common during initial connection when server is still starting
      // Socket.IO will automatically retry with reconnection logic
      if (error.message && (error.message === 'timeout' || error.message.toLowerCase().includes('timeout'))) {
        // Only log once per connection attempt to avoid spam
        if (this.reconnectAttempts === 0) {
          wsDebug('⏳ WebSocket connection timeout (will retry automatically)');
        }
        this.isConnected = false;
        return;
      }
      
      console.error('❌ WebSocket connection error:', error);
      this.isConnected = false;
      
      // Handle authentication errors - redirect to login for expired/invalid tokens
      // Check for various auth error messages
      const isAuthError = error.message === 'Invalid token' || 
                         error.message === 'Authentication required' ||
                         error.message?.toLowerCase().includes('token') ||
                         error.message?.toLowerCase().includes('auth');
      
      if (isAuthError) {
          if (feDebug('FE_DEBUG_AUTH')) console.log('🔑 WebSocket auth error - token expired or invalid');
        handleAuthError('WebSocket authentication failed');
        return;
      }
      
      // For all other errors (network issues, server down, etc.), just log and continue
    });

    this.socket.on('reconnect', (attemptNumber) => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.socket.on('reconnect_error', (error) => {
      // Suppress errors during page unload/refresh
      const readyState = document.readyState as string;
      if (readyState === 'unloading' || readyState === 'loading') {
        return;
      }
      
      // Suppress "WebSocket is closed before the connection is established" errors
      // This is common during page refreshes when Socket.IO is upgrading from polling to websocket
      if (error.message && error.message.includes('WebSocket is closed before the connection is established')) {
        return;
      }
      
      // Suppress timeout errors during reconnection - Socket.IO will continue retrying
      if (error.message && (error.message === 'timeout' || error.message.toLowerCase().includes('timeout'))) {
        // Only log occasionally to avoid spam during reconnection attempts
        if (this.reconnectAttempts % 3 === 0) {
          wsDebug(`⏳ WebSocket reconnection timeout (attempt ${this.reconnectAttempts + 1}, will continue retrying)`);
        }
        this.reconnectAttempts++;
        return;
      }
      
      console.error('❌ WebSocket reconnection error:', error);
      this.reconnectAttempts++;
    });

    this.socket.on('reconnect_failed', () => {
      console.error('❌ WebSocket reconnection failed after', this.maxReconnectAttempts, 'attempts');
      this.isConnected = false;
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  joinBoard(boardId: string) {
    if (this.socket?.connected) {
      this.socket.emit('join-board', boardId);
      
      // Add debugging to see if we're actually in the room
      this.socket.on('joined-room', (data) => {
      });
    } else {
    }
  }

  // Method to join board when WebSocket becomes ready
  joinBoardWhenReady(boardId: string) {
    if (this.socket?.connected) {
      this.joinBoard(boardId);
    } else {
      // Store the boardId to join when ready
      this.pendingBoardJoin = boardId;
    }
  }

  leaveBoard(boardId: string) {
    if (this.socket?.connected) {
      this.socket.emit('leave-board', boardId);
    }
  }

  /**
   * One Socket.IO listener per event name. Dedupe once, then fan out to every
   * registered callback — otherwise the first listener consumes `_rtId` and
   * later subscribers (e.g. TaskDetails vs TaskCard) never see the update.
   */
  private ensureSocketDispatcher(eventName: string) {
    if (!this.socket || this.socketDispatchBound.has(eventName)) return;
    this.socketDispatchBound.add(eventName);
    wsDebug(`🔧 [WebSocket] Binding Socket.IO dispatcher for event: ${eventName}`, {
      socketConnected: this.socket.connected,
    });
    this.socket.on(eventName, (...args) => {
      wsDebug(`📨 [WebSocket] Socket.IO event received: ${eventName}`, args);
      const { deliver, args: out } = prepareRealtimeSocketArgs(eventName, args);
      if (!deliver) return;
      const callbacks = [...(this.eventCallbacks.get(eventName) || [])];
      for (const cb of callbacks) {
        try {
          cb(...out);
        } catch (err) {
          console.error(`WebSocket callback error for ${eventName}:`, err);
        }
      }
    });
  }

  // Helper method to register callback with duplicate prevention
  private registerCallback(eventName: string, callback: Function) {
    if (!this.eventCallbacks.has(eventName)) {
      this.eventCallbacks.set(eventName, []);
    }
    
    const callbacks = this.eventCallbacks.get(eventName)!;
    // Prevent duplicate registration of the same callback
    if (!callbacks.includes(callback)) {
      callbacks.push(callback);
      if (this.socket) {
        this.ensureSocketDispatcher(eventName);
      } else {
        wsDebug(`⚠️ [WebSocket] Socket not available, callback stored for event: ${eventName}`);
      }
    } else {
      wsDebug(`⚠️ [WebSocket] Duplicate callback prevented for event: ${eventName}`);
    }
  }

  // Re-register all stored event listeners
  private reregisterEventListeners() {
    if (!this.socket) {
      console.warn('⚠️ [WebSocket] Cannot re-register listeners: socket is null');
      return;
    }
    
    wsDebug(`🔄 [WebSocket] Re-registering ${this.eventCallbacks.size} event types`);
    
    // CRITICAL: Remove all existing listeners first to prevent duplicates during reconnection storms
    this.socketDispatchBound.clear();
    this.eventCallbacks.forEach((_callbacks, eventName) => {
      this.socket?.removeAllListeners(eventName);
    });
    
    // One dispatcher per event; callbacks are read from the map on each emit
    this.eventCallbacks.forEach((_callbacks, eventName) => {
      this.ensureSocketDispatcher(eventName);
    });
    
    wsDebug(`✅ [WebSocket] Re-registration complete`);
  }

  // Helper method to store and register event listeners
  private addEventListener(eventName: string, callback: Function) {
    // Use registerCallback helper which prevents duplicates
    this.registerCallback(eventName, callback);
  }

  // Event listeners
  onTaskCreated(callback: (data: any) => void) {
    this.addEventListener('task-created', callback);
  }

  onTaskUpdated(callback: (data: any) => void) {
    this.addEventListener('task-updated', callback);
  }

  onTaskWorkUpdated(callback: (data: any) => void) {
    this.addEventListener('task-work-updated', callback);
  }

  onTaskDeleted(callback: (data: any) => void) {
    this.addEventListener('task-deleted', callback);
  }

  onTaskRestored(callback: (data: any) => void) {
    this.addEventListener('task-restored', callback);
  }

  onTaskPurged(callback: (data: any) => void) {
    this.addEventListener('task-purged', callback);
  }

  onTasksPositionsUpdated(callback: (data: any) => void) {
    this.addEventListener('tasks-positions-updated', callback);
  }

  onTaskRelationshipCreated(callback: (data: any) => void) {
    this.addEventListener('task-relationship-created', callback);
  }

  onTaskRelationshipDeleted(callback: (data: any) => void) {
    this.addEventListener('task-relationship-deleted', callback);
  }

  onColumnCreated(callback: (data: any) => void) {
    this.addEventListener('column-created', callback);
  }

  onColumnUpdated(callback: (data: any) => void) {
    this.addEventListener('column-updated', callback);
  }

  onColumnDeleted(callback: (data: any) => void) {
    this.addEventListener('column-deleted', callback);
  }

  onColumnReordered(callback: (data: any) => void) {
    this.addEventListener('column-reordered', callback);
  }

  onBoardCreated(callback: (data: any) => void) {
    this.addEventListener('board-created', callback);
  }

  onBoardUpdated(callback: (data: any) => void) {
    this.addEventListener('board-updated', callback);
  }

  onBoardDeleted(callback: (data: any) => void) {
    this.addEventListener('board-deleted', callback);
  }

  onBoardRestored(callback: (data: any) => void) {
    this.addEventListener('board-restored', callback);
  }

  onBoardReordered(callback: (data: any) => void) {
    this.addEventListener('board-reordered', callback);
  }

  onTaskWatcherAdded(callback: (data: any) => void) {
    this.addEventListener('task-watcher-added', callback);
  }

  onTaskWatcherRemoved(callback: (data: any) => void) {
    this.addEventListener('task-watcher-removed', callback);
  }

  onTaskCollaboratorAdded(callback: (data: any) => void) {
    this.addEventListener('task-collaborator-added', callback);
  }

  onTaskCollaboratorRemoved(callback: (data: any) => void) {
    this.addEventListener('task-collaborator-removed', callback);
  }

  onMemberUpdated(callback: (data: any) => void) {
    this.addEventListener('member-updated', callback);
  }

  onActivityUpdated(callback: (data: any) => void) {
    this.addEventListener('activity-updated', callback);
  }

  onNotificationQueueUpdated(callback: (data: any) => void) {
    this.addEventListener('notification-queue-updated', callback);
  }

  onMemberCreated(callback: (data: any) => void) {
    this.addEventListener('member-created', callback);
  }

  onMemberDeleted(callback: (data: any) => void) {
    this.addEventListener('member-deleted', callback);
  }

  onUserActivity(callback: (data: any) => void) {
    this.addEventListener('user-activity', callback);
  }

  onWebSocketReady(callback: () => void) {
    // Prevent duplicate registration
    if (!this.readyCallbacks.includes(callback)) {
      this.readyCallbacks.push(callback);
      
      // If already connected, call immediately
      if (this.isConnected) {
        callback();
      }
    }
  }

  // Send user activity
  sendUserActivity(data: any) {
    if (this.socket?.connected) {
      this.socket.emit('user-activity', data);
    }
  }

  // Helper method to remove event listener from both socket and eventCallbacks map
  private removeEventListener(eventName: string, callback?: Function) {
    if (callback) {
      const callbacks = this.eventCallbacks.get(eventName);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        // Keep the single Socket.IO dispatcher; it no-ops when the list is empty
        if (callbacks.length === 0) {
          this.eventCallbacks.delete(eventName);
          this.socket?.off(eventName);
          this.socketDispatchBound.delete(eventName);
        }
      }
    } else {
      this.socket?.off(eventName);
      this.eventCallbacks.delete(eventName);
      this.socketDispatchBound.delete(eventName);
    }
  }

  // Remove event listeners
  offTaskCreated(callback?: (data: any) => void) {
    this.removeEventListener('task-created', callback);
  }

  offTaskUpdated(callback?: (data: any) => void) {
    this.removeEventListener('task-updated', callback);
  }

  offTaskWorkUpdated(callback?: (data: any) => void) {
    this.removeEventListener('task-work-updated', callback);
  }

  offTaskDeleted(callback?: (data: any) => void) {
    this.removeEventListener('task-deleted', callback);
  }

  offTaskRestored(callback?: (data: any) => void) {
    this.removeEventListener('task-restored', callback);
  }

  offTaskPurged(callback?: (data: any) => void) {
    this.removeEventListener('task-purged', callback);
  }

  offTasksPositionsUpdated(callback?: (data: any) => void) {
    this.removeEventListener('tasks-positions-updated', callback);
  }

  offTaskRelationshipCreated(callback?: (data: any) => void) {
    this.removeEventListener('task-relationship-created', callback);
  }

  offTaskRelationshipDeleted(callback?: (data: any) => void) {
    this.removeEventListener('task-relationship-deleted', callback);
  }

  offColumnCreated(callback?: (data: any) => void) {
    this.removeEventListener('column-created', callback);
  }

  offColumnUpdated(callback?: (data: any) => void) {
    this.removeEventListener('column-updated', callback);
  }

  offColumnDeleted(callback?: (data: any) => void) {
    this.removeEventListener('column-deleted', callback);
  }

  offColumnReordered(callback?: (data: any) => void) {
    this.removeEventListener('column-reordered', callback);
  }

  offBoardCreated(callback?: (data: any) => void) {
    this.removeEventListener('board-created', callback);
  }

  offBoardUpdated(callback?: (data: any) => void) {
    this.removeEventListener('board-updated', callback);
  }

  offBoardDeleted(callback?: (data: any) => void) {
    this.removeEventListener('board-deleted', callback);
  }

  offBoardRestored(callback?: (data: any) => void) {
    this.removeEventListener('board-restored', callback);
  }

  offBoardReordered(callback?: (data: any) => void) {
    this.removeEventListener('board-reordered', callback);
  }

  offTaskWatcherAdded(callback?: (data: any) => void) {
    this.removeEventListener('task-watcher-added', callback);
  }

  offTaskWatcherRemoved(callback?: (data: any) => void) {
    this.removeEventListener('task-watcher-removed', callback);
  }

  offTaskCollaboratorAdded(callback?: (data: any) => void) {
    this.removeEventListener('task-collaborator-added', callback);
  }

  offTaskCollaboratorRemoved(callback?: (data: any) => void) {
    this.removeEventListener('task-collaborator-removed', callback);
  }

  offMemberUpdated(callback?: (data: any) => void) {
    this.removeEventListener('member-updated', callback);
  }

  offActivityUpdated(callback?: (data: any) => void) {
    this.removeEventListener('activity-updated', callback);
  }

  offNotificationQueueUpdated(callback?: (data: any) => void) {
    this.removeEventListener('notification-queue-updated', callback);
  }

  offMemberCreated(callback?: (data: any) => void) {
    this.removeEventListener('member-created', callback);
  }

  offMemberDeleted(callback?: (data: any) => void) {
    this.removeEventListener('member-deleted', callback);
  }

  offUserActivity(callback?: (data: any) => void) {
    this.socket?.off('user-activity', callback);
  }

  // Instance status events
  onInstanceStatusUpdated(callback: (data: any) => void) {
    this.addEventListener('instance-status-updated', callback);
  }

  offInstanceStatusUpdated(callback?: (data: any) => void) {
    this.removeEventListener('instance-status-updated', callback);
  }

  // Version update events
  onVersionUpdated(callback: (data: any) => void) {
    this.addEventListener('version-updated', callback);
  }

  offVersionUpdated(callback?: (data: any) => void) {
    this.removeEventListener('version-updated', callback);
  }

  offWebSocketReady(callback?: () => void) {
    if (callback) {
      const index = this.readyCallbacks.indexOf(callback);
      if (index > -1) {
        this.readyCallbacks.splice(index, 1);
      }
    } else {
      this.readyCallbacks = [];
    }
  }

  // Utility methods
  isWebSocketConnected() {
    return this.isConnected && this.socket?.connected;
  }

  getSocketId() {
    return this.socket?.id;
  }

  // Force reconnect with new token
  reconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.connect();
  }

  // Filter events
  onFilterCreated(callback: (data: any) => void) {
    this.addEventListener('filter-created', callback);
  }

  offFilterCreated(callback?: (data: any) => void) {
    this.removeEventListener('filter-created', callback);
  }

  onFilterUpdated(callback: (data: any) => void) {
    this.addEventListener('filter-updated', callback);
  }

  offFilterUpdated(callback?: (data: any) => void) {
    this.removeEventListener('filter-updated', callback);
  }

  onFilterDeleted(callback: (data: any) => void) {
    this.addEventListener('filter-deleted', callback);
  }

  offFilterDeleted(callback?: (data: any) => void) {
    this.removeEventListener('filter-deleted', callback);
  }

  // Comment events
  onCommentCreated(callback: (data: any) => void) {
    this.addEventListener('comment-created', callback);
  }

  offCommentCreated(callback?: (data: any) => void) {
    this.removeEventListener('comment-created', callback);
  }

  onCommentUpdated(callback: (data: any) => void) {
    this.addEventListener('comment-updated', callback);
  }

  offCommentUpdated(callback?: (data: any) => void) {
    this.removeEventListener('comment-updated', callback);
  }

  onCommentDeleted(callback: (data: any) => void) {
    this.addEventListener('comment-deleted', callback);
  }

  offCommentDeleted(callback?: (data: any) => void) {
    this.removeEventListener('comment-deleted', callback);
  }

  // Attachment events
  onAttachmentCreated(callback: (data: any) => void) {
    this.addEventListener('attachment-created', callback);
  }

  offAttachmentCreated(callback?: (data: any) => void) {
    this.removeEventListener('attachment-created', callback);
  }

  onAttachmentDeleted(callback: (data: any) => void) {
    this.addEventListener('attachment-deleted', callback);
  }

  offAttachmentDeleted(callback?: (data: any) => void) {
    this.removeEventListener('attachment-deleted', callback);
  }

  // User profile events
  onUserProfileUpdated(callback: (data: any) => void) {
    this.addEventListener('user-profile-updated', callback);
  }

  offUserProfileUpdated(callback?: (data: any) => void) {
    this.removeEventListener('user-profile-updated', callback);
  }

  // Tag management events
  onTagCreated(callback: (data: any) => void) {
    this.addEventListener('tag-created', callback);
  }

  offTagCreated(callback?: (data: any) => void) {
    this.removeEventListener('tag-created', callback);
  }

  onTagUpdated(callback: (data: any) => void) {
    this.addEventListener('tag-updated', callback);
  }

  offTagUpdated(callback?: (data: any) => void) {
    this.removeEventListener('tag-updated', callback);
  }

  onTagDeleted(callback: (data: any) => void) {
    this.addEventListener('tag-deleted', callback);
  }

  offTagDeleted(callback?: (data: any) => void) {
    this.removeEventListener('tag-deleted', callback);
  }

  // Priority management events
  onPriorityCreated(callback: (data: any) => void) {
    this.addEventListener('priority-created', callback);
  }

  offPriorityCreated(callback?: (data: any) => void) {
    this.removeEventListener('priority-created', callback);
  }

  onPriorityUpdated(callback: (data: any) => void) {
    this.addEventListener('priority-updated', callback);
  }

  offPriorityUpdated(callback?: (data: any) => void) {
    this.removeEventListener('priority-updated', callback);
  }

  onPriorityDeleted(callback: (data: any) => void) {
    this.addEventListener('priority-deleted', callback);
  }

  offPriorityDeleted(callback?: (data: any) => void) {
    this.removeEventListener('priority-deleted', callback);
  }

  onPriorityReordered(callback: (data: any) => void) {
    this.addEventListener('priority-reordered', callback);
  }

  offPriorityReordered(callback?: (data: any) => void) {
    this.removeEventListener('priority-reordered', callback);
  }

  // Sprint management events
  onSprintCreated(callback: (data: any) => void) {
    this.addEventListener('sprint-created', callback);
  }

  offSprintCreated(callback?: (data: any) => void) {
    this.removeEventListener('sprint-created', callback);
  }

  onSprintUpdated(callback: (data: any) => void) {
    this.addEventListener('sprint-updated', callback);
  }

  offSprintUpdated(callback?: (data: any) => void) {
    this.removeEventListener('sprint-updated', callback);
  }

  onSprintDeleted(callback: (data: any) => void) {
    this.addEventListener('sprint-deleted', callback);
  }

  offSprintDeleted(callback?: (data: any) => void) {
    this.removeEventListener('sprint-deleted', callback);
  }

  // Settings update events
  onSettingsUpdated(callback: (data: any) => void) {
    this.addEventListener('settings-updated', callback);
  }

  offSettingsUpdated(callback?: (data: any) => void) {
    this.removeEventListener('settings-updated', callback);
  }

  // Task snapshots update events
  onTaskSnapshotsUpdated(callback: (data: any) => void) {
    this.addEventListener('task-snapshots-updated', callback);
  }

  offTaskSnapshotsUpdated(callback?: (data: any) => void) {
    this.removeEventListener('task-snapshots-updated', callback);
  }

  // User management events
  onUserCreated(callback: (data: any) => void) {
    this.addEventListener('user-created', callback);
  }

  offUserCreated(callback?: (data: any) => void) {
    this.removeEventListener('user-created', callback);
  }

  onUserUpdated(callback: (data: any) => void) {
    this.addEventListener('user-updated', callback);
  }

  offUserUpdated(callback?: (data: any) => void) {
    this.removeEventListener('user-updated', callback);
  }

  onUserRoleUpdated(callback: (data: any) => void) {
    this.addEventListener('user-role-updated', callback);
  }

  offUserRoleUpdated(callback?: (data: any) => void) {
    this.removeEventListener('user-role-updated', callback);
  }

  onUserDeleted(callback: (data: any) => void) {
    this.addEventListener('user-deleted', callback);
  }

  offUserDeleted(callback?: (data: any) => void) {
    this.removeEventListener('user-deleted', callback);
  }

  // Task tag events
  onTaskTagAdded(callback: (data: any) => void) {
    wsDebug('🔧 [WebSocket] Registering task-tag-added event listener');
    this.addEventListener('task-tag-added', callback);
    wsDebug('✅ [WebSocket] task-tag-added event listener registered');
  }

  offTaskTagAdded(callback?: (data: any) => void) {
    this.removeEventListener('task-tag-added', callback);
  }

  onTaskTagRemoved(callback: (data: any) => void) {
    this.addEventListener('task-tag-removed', callback);
  }

  offTaskTagRemoved(callback?: (data: any) => void) {
    this.removeEventListener('task-tag-removed', callback);
  }

  // Connection status methods
  getIsConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

  // Subscribe to connect event
  onConnect(callback: () => void) {
    this.registerCallback('connect', callback);
  }

  offConnect(callback: () => void) {
    const callbacks = this.eventCallbacks.get('connect') || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
    
    if (this.socket) {
      this.socket.off('connect', callback);
    }
  }

  // Subscribe to disconnect event
  onDisconnect(callback: () => void) {
    this.registerCallback('disconnect', callback);
  }

  offDisconnect(callback: () => void) {
    const callbacks = this.eventCallbacks.get('disconnect') || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
    
    if (this.socket) {
      this.socket.off('disconnect', callback);
    }
  }
}

export default new WebSocketClient();
