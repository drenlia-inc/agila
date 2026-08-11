import { useState, useEffect, useRef, useCallback } from 'react';
import { CurrentUser, SiteSettings } from '../types';
import { DEFAULT_SITE_SETTINGS } from '../constants';
import * as api from '../api';
import { clearAllUserPreferenceCookies, clearOtherUserPreferenceCookies } from '../utils/userPreferences';
import { registerLogoutCallback, unregisterLogoutCallback, markAsAuthenticated } from '../utils/authErrorHandler';
import { feDebug } from '../utils/clientDebug';
import { clearMediaSession, establishMediaSession, startMediaSessionRefresh } from '../utils/mediaSession';
import { clearHelpSession } from '../utils/helpSessionPersistence';

// Get intended destination from HTML capture
const getInitialIntendedDestination = (): string | null => {
  const captured = localStorage.getItem('capturedIntendedDestination');
  if (captured) {
    localStorage.removeItem('capturedIntendedDestination'); // Clean up
    return captured;
  }
  return null;
};

const INITIAL_INTENDED_DESTINATION = getInitialIntendedDestination();

interface UseAuthReturn {
  // State
  isAuthenticated: boolean;
  authChecked: boolean;
  currentUser: CurrentUser | null;
  siteSettings: SiteSettings;
  hasDefaultAdmin: boolean | null;
  intendedDestination: string | null;
  justRedirected: boolean;
  
  // Actions
  handleLogin: (userData: any, token: string) => Promise<void>;
  handleLogout: () => void;
  handleProfileUpdated: () => Promise<void>;
  refreshSiteSettings: () => Promise<void>;
  setSiteSettings: (settings: SiteSettings) => void;
  setCurrentUser: (user: CurrentUser | null) => void;
}

interface UseAuthCallbacks {
  onDataClear: () => void;
  onAdminRefresh: () => void;
  onPageChange: (page: 'kanban' | 'admin') => void;
  onMembersRefresh: () => Promise<void>;
}

export const useAuth = (callbacks: UseAuthCallbacks): UseAuthReturn => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [hasDefaultAdmin, setHasDefaultAdmin] = useState<boolean | null>(null);
  const [authChecked, setAuthChecked] = useState(false); // Track if auth has been checked
  const isProcessingOAuthRef = useRef(false);
  const [justRedirected, setJustRedirected] = useState(false); // Prevent auto-board-selection after redirect
  const mountCheckCompletedRef = useRef(false); // Track if mount check has completed
  
  // Intended destination for redirecting after login
  const [intendedDestination, setIntendedDestination] = useState<string | null>(INITIAL_INTENDED_DESTINATION);

  // Redirect to login if user is unauthenticated and has intended destination
  useEffect(() => {
    // Only redirect after auth has been checked
    if (!authChecked) {
      return;
    }
    
    // Don't redirect if we have a token (user might be in the process of logging in)
    const token = localStorage.getItem('authToken');
    if (token && !isAuthenticated) {
      console.log('🔑 Token exists but not authenticated yet - waiting for auth check to complete');
      return;
    }
    
    if (!isAuthenticated && intendedDestination) {
      // Store intended destination in localStorage for OAuth callback
      localStorage.setItem('oauthIntendedDestination', intendedDestination);
      // Redirect to root login page to avoid keeping pathname
      window.location.href = window.location.origin + '/#login';
    }
  }, [isAuthenticated, authChecked, intendedDestination]);

  // Authentication handlers
  const handleLogin = async (userData: any, token: string, skipEventDispatch = false) => {
    const normalized = api.normalizeAuthToken(token) || token;
    api.clearAuthInterceptorBlock();
    localStorage.setItem('authToken', normalized);

    // HttpOnly media cookie before UI renders images (I3)
    await establishMediaSession();
    startMediaSessionRefresh();

    setCurrentUser(userData);
    setIsAuthenticated(true);
    
    // Dispatch custom event to notify SettingsContext of auth change (storage event doesn't fire for same-tab changes)
    // Skip if event was already dispatched (e.g., during OAuth callback)
    if (!skipEventDispatch) {
      window.dispatchEvent(new CustomEvent('auth-token-changed', { detail: { hasToken: true } }));
    }
    
    // Mark user as authenticated for auth error handler
    markAsAuthenticated();
    
    // Clear old user preference cookies to prevent accumulation
    clearOtherUserPreferenceCookies(userData.id);
    
    // Note: APP_URL update is now handled during user preferences initialization
    // in App.tsx, which runs reliably after login completes
    
    // Redirect to intended destination if available
    if (intendedDestination) {
      
      // Handle full path vs hash-only destinations
      if (intendedDestination.startsWith('/')) {
        // Full path with pathname + hash (e.g., "/project/#PROJ-00004#TASK-00001")
        // For local auth, check if we're already on the correct pathname
        if (window.location.pathname === intendedDestination.split('#')[0]) {
          // Same pathname, just update hash to avoid page reload
          const hashIndex = intendedDestination.indexOf('#');
          if (hashIndex !== -1) {
            const hashPart = intendedDestination.substring(hashIndex);
            window.location.hash = hashPart;
            // Clear intended destination after navigation completes
            setJustRedirected(true);
            setTimeout(() => {
              setIntendedDestination(null);
              // Clear the redirect flag after auto-board-selection would have run
              setTimeout(() => {
                setJustRedirected(false);
              }, 100);
            }, 200);
          } else {
            window.location.hash = '#kanban';
          }
        } else {
          // Different pathname, but still try to avoid page reload if possible
          // For local auth, try using history API first to avoid page reload
          try {
            window.history.pushState(null, '', intendedDestination);
            // Then trigger a hash change to make the app respond
            setTimeout(() => {
              const hashPart = intendedDestination.split('#')[1];
              if (hashPart) {
                window.location.hash = '#' + hashPart;
              }
              // Clear intended destination after navigation completes
              setJustRedirected(true);
              setTimeout(() => {
                setIntendedDestination(null);
                // Clear the redirect flag after auto-board-selection would have run
                setTimeout(() => {
                  setJustRedirected(false);
                }, 100);
              }, 200);
            }, 100);
          } catch (e) {
            // Fallback to full URL redirect if history API fails
            window.location.href = window.location.origin + intendedDestination;
          }
        }
      } else {
        // Hash-only destination (e.g., "#PROJ-00004#TASK-00001") 
        window.location.hash = intendedDestination;
        // Clear intended destination after navigation completes
        setJustRedirected(true);
        setTimeout(() => {
          setIntendedDestination(null);
          // Clear the redirect flag after auto-board-selection would have run
          setTimeout(() => {
            setJustRedirected(false);
          }, 100);
        }, 200);
      }
    } else {
      // Stay off #login after auth — otherwise routing treats it as a board id and
      // clears/reselects the board in a loop (common after demo reset → login).
      const rawHash = window.location.hash || '';
      const main = rawHash.replace(/^#/, '').split(/[?#]/)[0].toLowerCase();
      if (!main || main === 'login') {
        window.location.hash = '#kanban';
      }
    }
  };

  const handleLogout = useCallback(() => {
    void clearMediaSession();
    localStorage.removeItem('authToken');
    setCurrentUser(null);
    setIsAuthenticated(false);
    
    // Dispatch custom event to notify SettingsContext of auth change (storage event doesn't fire for same-tab changes)
    window.dispatchEvent(new CustomEvent('auth-token-changed', { detail: { hasToken: false } }));
    
    // Clear ALL intended destination storage to prevent stale redirects
    localStorage.removeItem('oauthIntendedDestination');
    localStorage.removeItem('capturedIntendedDestination');
    sessionStorage.removeItem('originalIntendedUrl');
    setIntendedDestination(null);
    setJustRedirected(false);
    
    // Clear ALL user preference cookies to prevent cookie bloat
    clearAllUserPreferenceCookies();

    // Help open/minimized is session-only — do not carry into the next login
    clearHelpSession();
    
    callbacks.onPageChange('kanban'); // Reset to kanban page
    callbacks.onDataClear(); // Clear all app data
    window.location.hash = ''; // Clear URL hash
  }, [callbacks]);

  // Register logout callback for auth error handler (after handleLogout is defined)
  useEffect(() => {
    registerLogoutCallback(handleLogout);
    return () => {
      unregisterLogoutCallback();
    };
  }, [handleLogout]);

  // Cross-tab logout: when another tab clears authToken, mirror logout here.
  // `storage` only fires in *other* documents, so this does not loop with same-tab logout.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'authToken') return;
      // Token removed or emptied in another tab while this tab still thinks it is logged in
      if ((e.newValue === null || e.newValue === '') && e.oldValue) {
        if (feDebug('FE_DEBUG_AUTH')) {
          console.log('🔑 authToken cleared in another tab — logging out this session');
        }
        sessionStorage.setItem('tokenExpiredRedirect', 'true');
        handleLogout();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [handleLogout]);

  // Escape hatch for ghost sessions (authenticated without user → App shows "Restoring session…").
  // Skip while OAuth is mid-flight: isAuthenticated is set before /me returns.
  useEffect(() => {
    if (!isAuthenticated || currentUser || isProcessingOAuthRef.current) return;
    const timer = window.setTimeout(() => {
      if (isProcessingOAuthRef.current) return;
      if (!localStorage.getItem('authToken')) return;
      // Still authenticated with no user after waiting — clear the stuck state
      console.warn('🔑 Ghost session timed out — logging out');
      // Login page reads this and shows sessionExpired (same pattern as token expiry)
      sessionStorage.setItem('tokenExpiredRedirect', 'true');
      handleLogout();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, currentUser, handleLogout]);

  const handleProfileUpdated = async () => {
    try {
      // Refresh current user data to get updated avatar and roles
      const response = await api.getCurrentUser();
      setCurrentUser(response.user);
      
      // If a fresh token is provided (for role updates), save it
      if (response.token) {
        localStorage.setItem('authToken', response.token);
        console.log('🔑 Updated JWT token with fresh roles');
        void establishMediaSession();
      }
      
      // Also refresh members to get updated display names
      await callbacks.onMembersRefresh();
      
      // If current user is admin, also refresh admin data to show updated display names
      if (response.user.roles?.includes('admin')) {
        callbacks.onAdminRefresh();
      }
    } catch (error) {
      console.error('Failed to refresh profile data:', error);
    }
  };

  // refreshSiteSettings removed - use SettingsContext.refreshSettings() instead
  const refreshSiteSettings = async () => {
    // Settings are now managed by SettingsContext
    // Components should use useSettings().refreshSettings() instead
    console.warn('refreshSiteSettings called - use SettingsContext.refreshSettings() instead');
  };

  // Check authentication on app load
  useEffect(() => {
    // Skip if mount check already completed (prevent multiple runs)
    if (mountCheckCompletedRef.current) {
      console.log('🔑 Skipping mount auth check - already completed');
      return;
    }

    // OAuth callback owns auth — don't race with a stale localStorage token
    const hash = window.location.hash || '';
    if (
      hash.includes('token=') &&
      !hash.includes('reset-password') &&
      !hash.includes('activate-account')
    ) {
      console.log('🔑 Skipping mount auth check — OAuth token in URL hash');
      setAuthChecked(true);
      return;
    }
    
    // Skip if already authenticated (e.g., just logged in)
    if (isAuthenticated && currentUser) {
      console.log('🔑 Skipping mount auth check - user already authenticated');
      void establishMediaSession();
      startMediaSessionRefresh();
      setAuthChecked(true);
      mountCheckCompletedRef.current = true;
      return;
    }
    
    const token = api.normalizeAuthToken(localStorage.getItem('authToken'));
    console.log('🔑 Mount auth check starting:', { hasToken: !!token, isAuthenticated, hasCurrentUser: !!currentUser });
    
    if (token) {
      localStorage.setItem('authToken', token);
      // Verify token and get current user
      api.getCurrentUser()
        .then(async (response) => {
          if (!response?.user?.id) {
            console.log('🔑 Mount auth check got token but no user payload — clearing session');
            localStorage.removeItem('authToken');
            setIsAuthenticated(false);
            setCurrentUser(null);
            setAuthChecked(true);
            mountCheckCompletedRef.current = true;
            callbacks.onPageChange('kanban');
            return;
          }
          console.log('🔑 Mount auth check succeeded');
          await establishMediaSession();
          startMediaSessionRefresh();
          setCurrentUser(response.user);
          setIsAuthenticated(true);
          setAuthChecked(true);
          mountCheckCompletedRef.current = true;
          markAsAuthenticated(); // Mark as authenticated for auth error handler
        })
        .catch((error) => {
          // Clear token on auth failures: 401 (invalid/expired) and 404 (user deleted, e.g. demo reset)
          // Network errors or 503s shouldn't clear the token
          console.log('🔑 getCurrentUser on mount failed:', {
            status: error.response?.status,
            message: error.message,
            hasToken: !!localStorage.getItem('authToken')
          });
          
          const status = error.response?.status;
          if (status === 401 || status === 404) {
            console.log(`🔑 Token validation failed on mount (${status}) - clearing token`);
            // Clear all authentication data on error
            localStorage.removeItem('authToken');
            setIsAuthenticated(false);
            setCurrentUser(null);
            setAuthChecked(true);
            mountCheckCompletedRef.current = true;
            // Reset to kanban page to avoid admin page issues
            callbacks.onPageChange('kanban');
          } else {
            // Network error or other issue - don't clear token, just mark as checked
            console.warn('⚠️ Failed to verify token on mount (non-auth error), keeping token:', error.message);
            setIsAuthenticated(false);
            setCurrentUser(null);
            setAuthChecked(true);
            mountCheckCompletedRef.current = true;
            // Do not set isAuthenticated without a verified user (demo reset used to leave
            // a ghost session: authenticated + null user + empty board UI).
          }
        });
    } else {
      // No token, user is not authenticated
      console.log('🔑 Mount auth check - no token found');
      setAuthChecked(true);
      mountCheckCompletedRef.current = true;
    }
  }, []); // Only run once on mount

  // Site settings are now loaded by SettingsContext - no need to fetch here
  // SettingsContext provides settings via useSettings() hook

  // Check if default admin account exists
  useEffect(() => {
    const checkDefaultAdmin = async () => {
      try {
        // Check if default admin account exists using dedicated endpoint
        const response = await fetch('/api/auth/check-default-admin');
        
        if (response.ok) {
          const data = await response.json();
          setHasDefaultAdmin(data.exists);
        } else {
          // If we can't check, assume it exists for safety
          setHasDefaultAdmin(true);
        }
      } catch (error) {
        // Network or other errors - assume it exists for safety
        console.warn('Could not check default admin status, assuming exists for safety:', error);
        setHasDefaultAdmin(true);
      }
    };
    
    checkDefaultAdmin();
  }, []);


  // Handle Google OAuth callback with token - MUST run before routing
  useEffect(() => {
    // Check for token in URL hash (for OAuth callback)
    const hash = window.location.hash;
    
      
    // Skip password reset and account activation tokens - only handle OAuth tokens
    if (hash.includes('token=') && !hash.includes('reset-password') && !hash.includes('activate-account')) {
      const tokenMatch = hash.match(/token=([^&]+)/);
      const errorMatch = hash.match(/error=([^&]+)/);
      
      
      if (tokenMatch) {
        const token = api.normalizeAuthToken(decodeURIComponent(tokenMatch[1])) || decodeURIComponent(tokenMatch[1]);
        
        // Check for stored intended destination from before OAuth redirect
        const storedIntendedDestination = localStorage.getItem('oauthIntendedDestination');
        
        
        // Clear any activation context (no longer needed with simplified flow)
        localStorage.removeItem('activationContext');

        api.clearAuthInterceptorBlock();
        
        // Store the OAuth token
        localStorage.setItem('authToken', token);

        // Media cookie before UI paints avatars (I3)
        void establishMediaSession().then(() => {
          // Dispatch custom event IMMEDIATELY after storing token (before async operations)
          // This ensures SettingsContext can check admin role and fetch correct endpoint
          window.dispatchEvent(new CustomEvent('auth-token-changed', { detail: { hasToken: true } }));
          
          // Set OAuth processing flag to prevent interference BEFORE hash changes
          isProcessingOAuthRef.current = true;
          
          // Set authenticated immediately after media session is ready
          setIsAuthenticated(true);
          
          // Fetch current user data and call handleLogin BEFORE redirecting
          // This ensures APP_URL update happens before navigation
          api.getCurrentUser()
          .then(async response => {
            setCurrentUser(response.user);
            // Call handleLogin to trigger APP_URL update and other login logic
            // Skip event dispatch since we already dispatched it above to ensure SettingsContext checks admin role immediately
            await handleLogin(response.user, token, true);
            
            // Clear OAuth processing flag
            isProcessingOAuthRef.current = false;
            
            // Handle intended destination AFTER handleLogin completes
            const destinationToUse = intendedDestination || storedIntendedDestination;
            
            if (destinationToUse) {
              // Handle full path vs hash-only destinations
              if (destinationToUse.startsWith('/')) {
                // Full path with pathname + hash (e.g., "/project/#PROJ-00004#TASK-00001")
                // Use full URL to preserve pathname
                window.location.href = window.location.origin + destinationToUse;
              } else {
                // Hash-only destination (e.g., "#PROJ-00004#TASK-00001") 
                window.location.hash = destinationToUse;
              }
              
              // Clear intended destination after redirect
              setJustRedirected(true);
              setIntendedDestination(null);
              localStorage.removeItem('oauthIntendedDestination'); // Clean up
              
              // Clear the redirect flag after auto-board-selection would have run
              setTimeout(() => {
                setJustRedirected(false);
              }, 300);
            } else {
              // No intended destination, go to default kanban
              window.location.hash = '#kanban';
              // Also clear any stale intended destination storage for normal login
              localStorage.removeItem('oauthIntendedDestination');
              localStorage.removeItem('capturedIntendedDestination');
              sessionStorage.removeItem('originalIntendedUrl');
            }
          })
          .catch((error) => {
            console.error('Failed to get current user after OAuth:', error);
            // Avoid ghost session (authenticated + null user → "Restoring session…")
            isProcessingOAuthRef.current = false;
            localStorage.removeItem('authToken');
            setIsAuthenticated(false);
            setCurrentUser(null);
            setAuthChecked(true);
            const destinationToUse = intendedDestination || storedIntendedDestination;
            if (destinationToUse) {
              if (destinationToUse.startsWith('/')) {
                window.location.href = window.location.origin + destinationToUse;
              } else {
                window.location.hash = destinationToUse;
              }
            } else {
              window.location.hash = '#login';
            }
          });
        });
        
        return; // Exit early to prevent routing conflicts
      } else if (errorMatch) {
        // Handle OAuth errors
        console.error('OAuth error:', errorMatch[1]);
        // Clear the URL hash and redirect to login
        window.location.hash = '#login';
        return; // Exit early to prevent routing conflicts
      }
    }
  }, []);


  return {
    // State
    isAuthenticated,
    authChecked,
    currentUser,
    siteSettings,
    hasDefaultAdmin,
    intendedDestination,
    justRedirected,
    
    // Actions
    handleLogin,
    handleLogout,
    handleProfileUpdated,
    refreshSiteSettings,
    setSiteSettings,
    setCurrentUser,
  };
};
