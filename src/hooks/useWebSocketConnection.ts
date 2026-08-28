import { useCallback, RefObject } from 'react';
import websocketClient from '../services/websocketClient';

interface UseWebSocketConnectionProps {
  // State setters
  setIsOnline: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Refs
  selectedBoardRef: RefObject<string | null>;
  refreshBoardDataRef: RefObject<
    ((options?: { force?: boolean; forBoardId?: string }) => Promise<void>) | null
  >;
  hasConnectedOnceRef: RefObject<boolean>;
  wasOfflineRef: RefObject<boolean>;
  
  // Activity feed hook
  activityFeed: {
    syncActivityDelta: (lang?: string) => Promise<void>;
  };
}

export const useWebSocketConnection = ({
  setIsOnline,
  selectedBoardRef,
  refreshBoardDataRef,
  hasConnectedOnceRef,
  wasOfflineRef,
  activityFeed,
}: UseWebSocketConnectionProps) => {
  
  const handleWebSocketReady = useCallback(() => {
    // Listen for WebSocket ready event (simplified since we now use joinBoardWhenReady)
  }, []);

  const handleReconnect = useCallback(() => {
    const timestamp = new Date().toISOString();
    console.log(`✅ [${timestamp}] Socket connected, hasConnectedOnce:`, hasConnectedOnceRef.current, 'wasOffline:', wasOfflineRef.current);
    
    // CRITICAL: Always re-join the board room after reconnection
    // The useEffect for selectedBoard only fires when the board CHANGES, not on reconnection
    if (selectedBoardRef.current) {
      console.log(`📋 [${timestamp}] Re-joining board room after reconnection:`, selectedBoardRef.current);
      websocketClient.joinBoardWhenReady(selectedBoardRef.current);
    }
    
    // Only refresh if this is a RECONNECTION (not the first connection)
    if (hasConnectedOnceRef.current && wasOfflineRef.current) {
      // Wait longer for network to stabilize (both WebSocket AND HTTP)
      // Also add retry logic in case first attempt fails
      const attemptRefresh = async (retryCount = 0) => {
        try {
          const refreshTimestamp = new Date().toISOString();
          console.log(`🔄 [${refreshTimestamp}] WebSocket reconnected after being offline - refreshing data to sync changes (attempt`, retryCount + 1, ')');
          console.log(`📊 [${refreshTimestamp}] Current selectedBoard:`, selectedBoardRef.current);
          if (refreshBoardDataRef.current) {
            // Scope to the visible board; refreshBoardData skips setColumns when
            // the fetched snapshot matches local (no unnecessary flash).
            await refreshBoardDataRef.current({
              force: true,
              forBoardId: selectedBoardRef.current || undefined,
            });
            
            // Catch activity events missed while offline — delta only, not a full refetch.
            await activityFeed.syncActivityDelta();
            
            const successTimestamp = new Date().toISOString();
            console.log(`✅ [${successTimestamp}] Data refresh successful!`);
          } else {
            throw new Error('refreshBoardData not yet initialized');
          }
          
          // IMPORTANT: Don't reset wasOfflineRef immediately!
          // Keep it true for 3 seconds to ensure connection is stable
          // This prevents missing WebSocket events during reconnection flapping
          setTimeout(() => {
            wasOfflineRef.current = false;
            const stabilizedTimestamp = new Date().toISOString();
            console.log(`🔌 [${stabilizedTimestamp}] Connection stabilized, ready for real-time updates`);
          }, 3000);
        } catch (err) {
          console.error('❌ Failed to refresh on reconnect (attempt', retryCount + 1, '):', err);
          // Retry up to 3 times with exponential backoff
          if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
            console.log('⏳ Retrying in', delay / 1000, 'seconds...');
            setTimeout(() => attemptRefresh(retryCount + 1), delay);
          } else {
            console.error('❌ All refresh attempts failed. Please refresh the page manually.');
            wasOfflineRef.current = false; // Reset flag to avoid infinite retries
          }
        }
      };
      
      // Wait 1.5 seconds for both WebSocket and HTTP to stabilize
      setTimeout(() => attemptRefresh(), 1500);
    } else if (hasConnectedOnceRef.current) {
      const reconnectTimestamp = new Date().toISOString();
      console.log(`🔌 [${reconnectTimestamp}] Socket reconnected (but no offline period detected)`);
    } else {
      // Mark that we've connected for the first time
      const firstConnectTimestamp = new Date().toISOString();
      console.log(`🎉 [${firstConnectTimestamp}] First WebSocket connection established`);
      hasConnectedOnceRef.current = true;
    }
  }, [activityFeed.syncActivityDelta, selectedBoardRef, refreshBoardDataRef, hasConnectedOnceRef, wasOfflineRef]);

  const handleDisconnect = useCallback(() => {
    const disconnectTimestamp = new Date().toISOString();
    console.log(`🔴 [${disconnectTimestamp}] WebSocket disconnected - will refresh data on reconnect`);
    wasOfflineRef.current = true;
  }, [wasOfflineRef]);

  const handleBrowserOnline = useCallback(() => {
    console.log('🌐 Browser detected network is back online - forcing reconnect');
    setIsOnline(true);
    wasOfflineRef.current = true; // Mark as offline so we refresh on reconnect
    websocketClient.connect(); // Force reconnection attempt
  }, [setIsOnline, wasOfflineRef]);

  const handleBrowserOffline = useCallback(() => {
    console.log('🌐 Browser detected network went offline');
    setIsOnline(false);
    wasOfflineRef.current = true;
  }, [setIsOnline, wasOfflineRef]);

  return {
    handleWebSocketReady,
    handleReconnect,
    handleDisconnect,
    handleBrowserOnline,
    handleBrowserOffline,
  };
};

