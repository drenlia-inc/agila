import { useEffect, useState } from 'react';
import { initializeSocket, getSocket, disconnectSocket, isSocketConnected, joinBoard, leaveBoard, onSocketEvent, offSocketEvent } from '../utils/globalSocket';

interface UseSocketOptions {
  enabled?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

interface SocketEvents {
  // Task events
  'task:created': (data: { task: any; timestamp: string }) => void;
  'task:updated': (data: { task: any; timestamp: string }) => void;
  'task:deleted': (data: { taskId: string; columnId: string; boardId: string; timestamp: string }) => void;
  
  // Board events
  'board:created': (data: { board: any; timestamp: string }) => void;
  'board:updated': (data: { board: any; timestamp: string }) => void;
  'board:deleted': (data: { boardId: string; timestamp: string }) => void;
  
  // Column events
  'column:created': (data: { column: any; timestamp: string }) => void;
  'column:updated': (data: { column: any; timestamp: string }) => void;
  'column:deleted': (data: { columnId: string; boardId: string; timestamp: string }) => void;
  
  // Board join/leave events
  'user:joined': (data: { userId: string; firstName: string; lastName: string; timestamp: string }) => void;
  'user:left': (data: { userId: string; firstName: string; lastName: string; timestamp: string }) => void;
  
  // Comment events
  'comment:created': (data: { comment: any; taskId: string; timestamp: string }) => void;
  'comment:deleted': (data: { commentId: string; taskId: string; timestamp: string }) => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const { enabled = true, onConnect, onDisconnect, onError } = options;
  const [isConnected, setIsConnected] = useState(() => isSocketConnected());
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    // Check if already connected
    if (isSocketConnected()) {
      setIsConnected(true);
      onConnect?.();
      return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      setError('No authentication token available');
      return;
    }

    // Initialize connection only if not connected
    initializeSocket(token)
      .then(() => {
        setIsConnected(true);
        setError(null);
        onConnect?.();
      })
      .catch((err) => {
        console.error('❌ Socket.IO connection failed:', err);
        setError(err.message);
        setIsConnected(false);
        onError?.(err);
      });

  }, [enabled]); // Removed callbacks from dependencies to prevent HMR issues
  
  return {
    socket: getSocket(),
    isConnected,
    error,
    joinBoard: (boardId: string) => joinBoard(boardId),
    leaveBoard: (boardId: string) => leaveBoard(boardId),
    on: (event: string, handler: Function) => onSocketEvent(event, handler),
    off: (event: string, handler?: Function) => offSocketEvent(event, handler),
    emit: (event: string, data?: any) => {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit(event, data);
      }
    }
  };
}
