import { useState, useEffect, useRef, useCallback } from 'react';
import { CurrentUser, SiteSettings } from '../types';
import { DEFAULT_SITE_SETTINGS } from '../constants';
import * as api from '../api';
import { clearAllUserPreferenceCookies, clearOtherUserPreferenceCookies } from '../utils/userPreferences';
import { registerLogoutCallback, unregisterLogoutCallback, markAsAuthenticated } from '../utils/authErrorHandler';
import { feDebug } from '../utils/clientDebug';
import { clearMediaSession, establishMediaSession, startMediaSessionRefresh } from '../utils/mediaSession';
import { clearHelpSession } from '../utils/helpSessionPersistence';

/** Survives soft/hard navigation to `#login` (password + Google OAuth). */
const INTENDED_DESTINATION_KEY = 'oauthIntendedDestination';

function readStoredIntendedDestination(): string | null {
  try {
    return localStorage.getItem(INTENDED_DESTINATION_KEY);
  } catch {
    return null;
  }
}

function persistIntendedDestination(dest: string): void {
  try {
    localStorage.setItem(INTENDED_DESTINATION_KEY, dest);
  } catch {
    /* ignore */
  }
}

function clearStoredIntendedDestination(): void {
  try {
    localStorage.removeItem(INTENDED_DESTINATION_KEY);
    localStorage.removeItem('capturedIntendedDestination');
    sessionStorage.removeItem('originalIntendedUrl');
  } catch {
    /* ignore */
  }
}

/** OAuth must finish on the app host — auth.* serves the same SPA but is not the product URL. */
function redirectAuthHubOAuthToAppHost(): boolean {
  const { hostname, protocol, pathname, search, hash } = window.location;
  if (!/^auth\./i.test(hostname)) return false;
  if (!api.hashHasOAuthToken()) return false;
  const domain = hostname.replace(/^auth\./i, '');
  if (!domain || domain === hostname) return false;
  const appHost = `kanban.${domain}`;
  window.location.replace(`${protocol}//${appHost}${pathname}${search}${hash}`);
  return true;
}

// Run before the first React paint when the hub accidentally serves the SPA.
if (typeof window !== 'undefined') {
  redirectAuthHubOAuthToAppHost();
}

/** Pathname of `/project/#PROJ#TASK` or `/` for hash-only destinations. */
function destinationPathname(dest: string): string {
  if (!dest.startsWith('/')) return '/';
  const hashIdx = dest.indexOf('#');
  const path = hashIdx === -1 ? dest : dest.slice(0, hashIdx);
  return path || '/';
}

/** Full hash including leading `#`, keeping multiple `#` segments (project + task). */
function destinationHash(dest: string): string | null {
  const hashIdx = dest.indexOf('#');
  if (hashIdx === -1) return null;
  return dest.slice(hashIdx);
}

/**
 * Navigate to a captured post-login destination.
 * Uses full hash slice (not split('#')[1]) so `/project/#PROJ-1#TASK-2` stays intact.
 * If the URL is already correct, fire hashchange so App routing still runs.
 */
function applyIntendedDestination(dest: string): void {
  if (dest.startsWith('/')) {
    const path = destinationPathname(dest);
    const hash = destinationHash(dest);
    if (window.location.pathname !== path) {
      window.location.href = window.location.origin + dest;
      return;
    }
    if (hash) {
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      } else {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
    return;
  }

  const nextHash = dest.startsWith('#') ? dest : `#${dest}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  } else {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

// Get intended destination from HTML capture (and storage after a #login hop)
const getInitialIntendedDestination = (): string | null => {
  const captured = localStorage.getItem('capturedIntendedDestination');
  if (captured) {
    localStorage.removeItem('capturedIntendedDestination');
    persistIntendedDestination(captured);
    return captured;
  }

  const stored = readStoredIntendedDestination();
  if (!stored) return null;

  const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
  const main = hash.replace(/^#/, '').split(/[?#]/)[0].toLowerCase();
  // After hop to `/#login`, restore the deep link we persisted
  if (main === 'login') return stored;

  const pathAndHash =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${hash}`
      : '';
  // Still on the deep link itself (logged out, before soft #login switch)
  if (stored === hash || stored === pathAndHash) return stored;

  // Stale leftover from an abandoned login — don't force #login on a normal visit
  clearStoredIntendedDestination();
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

  // Persist deep link for after login. Login UI already renders when logged out;
  // only leave /project|/task so chrome stays on `/` (OAuth callback expects that).
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
      persistIntendedDestination(intendedDestination);
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      const onDeepPath = path === '/project' || path === '/task';
      if (onDeepPath) {
        // Full navigation — React state is restored from INTENDED_DESTINATION_KEY on reload
        window.location.href = `${window.location.origin}/#login`;
        return;
      }
      // Already on `/` (e.g. `/?lng=fr#reports`): soft-switch hash so we don't drop React state
      if (window.location.hash !== '#login') {
        window.location.hash = '#login';
      }
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
    
    // Prefer React state; fall back to storage (survives `/#login` hop + OAuth)
    const destinationToUse =
      intendedDestination || readStoredIntendedDestination();

    if (destinationToUse) {
      applyIntendedDestination(destinationToUse);
      clearStoredIntendedDestination();
      setJustRedirected(true);
      setTimeout(() => {
        setIntendedDestination(null);
        setTimeout(() => {
          setJustRedirected(false);
        }, 100);
      }, 200);
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
    clearStoredIntendedDestination();
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

    // OAuth callback owns auth — keep authChecked false so App stays on the
    // loader instead of flashing the login form (and then "Restoring session").
    if (api.hashHasOAuthToken()) {
      console.log('🔑 Skipping mount auth check — OAuth token in URL hash');
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

    if (redirectAuthHubOAuthToAppHost()) {
      return;
    }

    // Skip password reset and account activation tokens - only handle OAuth tokens
    if (api.hashHasOAuthToken()) {
      const tokenMatch = hash.match(/token=([^&]+)/);
      const errorMatch = hash.match(/error=([^&]+)/);
      
      
      if (tokenMatch) {
        const token = api.normalizeAuthToken(decodeURIComponent(tokenMatch[1])) || decodeURIComponent(tokenMatch[1]);

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

          // Fetch current user, then mark authenticated once — avoids Login / ghost-session flash
          api.getCurrentUser()
          .then(async response => {
            setCurrentUser(response.user);
            // handleLogin applies intended destination (state or storage) or leaves #login → #kanban
            await handleLogin(response.user, token, true);
            setAuthChecked(true);
            isProcessingOAuthRef.current = false;
          })
          .catch((error) => {
            console.error('Failed to get current user after OAuth:', error);
            // Avoid ghost session (authenticated + null user → "Restoring session…")
            isProcessingOAuthRef.current = false;
            localStorage.removeItem('authToken');
            setIsAuthenticated(false);
            setCurrentUser(null);
            setAuthChecked(true);
            window.location.hash = '#login';
          });
        });
        
        return; // Exit early to prevent routing conflicts
      } else if (errorMatch) {
        // Handle OAuth errors
        console.error('OAuth error:', errorMatch[1]);
        setAuthChecked(true);
        window.location.hash = '#login';
        return;
      } else {
        setAuthChecked(true);
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
