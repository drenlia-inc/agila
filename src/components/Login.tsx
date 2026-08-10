import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { login } from '../api';
import { Github, MousePointerClick, RefreshCw, Sparkles } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { setExplicitGuestLanguage } from '../utils/guestLanguage';
import { AGILA_GITHUB_URL } from '../constants';
import { resolvePublicBrandLogoSrc } from '../utils/brandLogo';

function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

interface LoginProps {
  onLogin: (userData: any, token: string) => Promise<void>;
  siteSettings?: any;
  hasDefaultAdmin?: boolean;
  intendedDestination?: string | null;
  onForgotPassword?: () => void;
}

export default function Login({ onLogin, siteSettings, hasDefaultAdmin = true, intendedDestination, onForgotPassword }: LoginProps) {
  const { t, i18n } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const { siteSettings: contextSiteSettings, isLoading: settingsLoading } = useSettings();
  const [theme, setTheme] = useState<'light' | 'dark'>(readDocumentTheme);
  const brandSettings = contextSiteSettings || siteSettings;
  const logoSrc = resolvePublicBrandLogoSrc(brandSettings, theme);
  const siteName = String(brandSettings?.SITE_NAME ?? '').trim();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Prefer i18n keys so errors re-translate on language toggle; raw is for API messages.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRaw, setErrorRaw] = useState('');

  const clearError = () => {
    setErrorKey(null);
    setErrorRaw('');
  };

  const setI18nError = (key: string) => {
    setErrorKey(key);
    setErrorRaw('');
  };

  const setRawError = (message: string) => {
    setErrorKey(null);
    setErrorRaw(message);
  };

  const errorMessage = errorKey ? t(errorKey) : errorRaw;

  useEffect(() => {
    const syncTheme = () => setTheme(readDocumentTheme());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);
  
  // Get current language for toggle
  const currentLanguage = (i18n.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  
  // For non-authenticated users: persist explicit choice so APP_LANGUAGE does not override it
  const handleLanguageToggle = async () => {
    const newLanguage = currentLanguage === 'en' ? 'fr' : 'en';
    setExplicitGuestLanguage(newLanguage);
    await i18n.changeLanguage(newLanguage);
  };
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [waitingForCredentials, setWaitingForCredentials] = useState(false);
  const [refreshingCredentials, setRefreshingCredentials] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState<boolean>(true);
  const [checkingBackend, setCheckingBackend] = useState<boolean>(true);

  // Check if demo mode is enabled
  const isDemoMode =
    import.meta.env.DEMO_ENABLED === 'true' || process.env.DEMO_ENABLED === 'true';

  /** Fetch once. Returns credentials only when the real seeded password is available. */
  const fetchAdminCredentials = useCallback(async (): Promise<{
    email: string;
    password: string;
  } | null> => {
    try {
      const response = await fetch('/api/auth/demo-credentials', { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        // Maintenance HTML / proxy noise — not ready
        return null;
      }
      const credentials = await response.json();
      if (
        response.ok &&
        credentials?.ready !== false &&
        credentials?.admin?.email &&
        typeof credentials.admin.password === 'string' &&
        credentials.admin.password.length > 0
      ) {
        return {
          email: credentials.admin.email,
          password: credentials.admin.password
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch admin credentials:', error);
      return null;
    }
  }, []);

  const handleRefreshCredentials = async () => {
    if (refreshingCredentials) return;
    setRefreshingCredentials(true);
    clearError();
    try {
      const creds = await fetchAdminCredentials();
      if (creds) {
        setCredentialsReady(true);
        setWaitingForCredentials(false);
      } else {
        setCredentialsReady(false);
        setWaitingForCredentials(true);
      }
    } finally {
      setRefreshingCredentials(false);
    }
  };

  // Check backend availability on mount and periodically
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;
    let retryTimeout: NodeJS.Timeout;

    const checkBackendHealth = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        // Use a lightweight endpoint for health check instead of /api/settings
        // This avoids duplicate settings fetches (SettingsContext handles settings)
        const response = await fetch('/api/auth/check-default-admin', { 
          signal: controller.signal,
          cache: 'no-store'
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          setBackendAvailable(true);
          setCheckingBackend(false);
          retryCount = 0; // Reset retry count on success
        } else {
          throw new Error('Backend responded with error');
        }
      } catch (error) {
        console.error('Backend health check failed:', error);
        retryCount++;
        
        if (retryCount >= maxRetries) {
          setBackendAvailable(false);
          setCheckingBackend(false);
        } else {
          // Retry after delay (exponential backoff: 2s, 4s, 8s)
          const delay = Math.min(2000 * Math.pow(2, retryCount - 1), 8000);
          retryTimeout = setTimeout(checkBackendHealth, delay);
        }
      }
    };

    checkBackendHealth();

    // Cleanup timeout on unmount
    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  // Poll until demo admin credentials are available (no fake "admin" fallback).
  useEffect(() => {
    if (!isDemoMode) {
      setCredentialsReady(false);
      setWaitingForCredentials(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const creds = await fetchAdminCredentials();
      if (cancelled) return;

      if (creds) {
        setCredentialsReady(true);
        setWaitingForCredentials(false);
        return;
      }

      setCredentialsReady(false);
      setWaitingForCredentials(true);
      timer = setTimeout(poll, 2000);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isDemoMode, fetchAdminCredentials]);

  // Check for token expiration / demo-reset redirect (store keys so language toggle updates text)
  useEffect(() => {
    const demoReset = sessionStorage.getItem('demoResetRedirect');
    if (demoReset === 'true') {
      setI18nError('login.demoWasReset');
      sessionStorage.removeItem('demoResetRedirect');
      return;
    }
    const tokenExpired = sessionStorage.getItem('tokenExpiredRedirect');
    if (tokenExpired === 'true') {
      setI18nError('login.sessionExpired');
      sessionStorage.removeItem('tokenExpiredRedirect');
    }
  }, []);

  // Check for OAuth errors in URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    
    if (errorParam) {
      let key = 'login.loginFailed';
      
      switch (errorParam) {
        case 'account_deactivated':
          key = 'login.accountDeactivated';
          break;
        case 'user_not_invited':
          key = 'login.accessDenied';
          break;
        case 'oauth_failed':
          key = 'login.oauthFailed';
          break;
        case 'oauth_not_configured':
          key = 'login.oauthNotConfigured';
          break;
        case 'oauth_userinfo_failed':
          key = 'login.oauthUserinfoFailed';
          break;
      }
      
      setI18nError(key);
      
      // Clean up the URL by removing the error parameter
      const newUrl = new URL(window.location);
      newUrl.searchParams.delete('error');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // Show Google sign-in only when public settings include a non-empty GOOGLE_CLIENT_ID
  // (see GET /api/settings in server/routes/settings.js). Wait for settings fetch to finish
  // so we do not keep the initial false when the first context value is still {}.
  useEffect(() => {
    if (settingsLoading) return;
    const raw = contextSiteSettings?.GOOGLE_CLIENT_ID;
    const enabled = typeof raw === 'string' && raw.trim().length > 0;
    setGoogleOAuthEnabled(enabled);
  }, [contextSiteSettings, settingsLoading]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setIsLoading(true);

    try {
      if (isDemoMode) {
        // Always fetch fresh credentials so a prior demo reset cannot leave us with a stale password
        const creds = await fetchAdminCredentials();
        if (!creds) {
          setCredentialsReady(false);
          setWaitingForCredentials(true);
          setI18nError('login.demoSignInFailedRefresh');
          return;
        }
        setCredentialsReady(true);
        setWaitingForCredentials(false);
        const response = await login(creds.email, creds.password);
        await onLogin(response.user, response.token);
        return;
      }

      const response = await login(email, password);
      await onLogin(response.user, response.token);
    } catch (error: any) {
      if (isDemoMode) {
        setI18nError('login.demoSignInFailedRefresh');
      } else {
        const apiMessage = error.response?.data?.error;
        if (typeof apiMessage === 'string' && apiMessage.trim()) {
          setRawError(apiMessage);
        } else {
          setI18nError('login.loginFailed');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!googleOAuthEnabled) {
      setI18nError('login.oauthNotConfigured');
      return;
    }

    clearError();
    setIsLoading(true);

    try {
      // Store intended destination before OAuth redirect
      if (intendedDestination) {
        localStorage.setItem('oauthIntendedDestination', intendedDestination);
      } else {
        // Clear any stale intended destination for normal login
        localStorage.removeItem('oauthIntendedDestination');
      }

      // Redirect to Google OAuth
      const response = await fetch('/api/auth/google/url');
      if (response.ok) {
        const { url } = await response.json();
        window.location.href = url;
      } else {
        throw new Error('Failed to get Google OAuth URL');
      }
    } catch (error: any) {
      setI18nError('login.oauthFailed');
      setIsLoading(false);
    }
  };

  const hideGithubLink =
    (contextSiteSettings?.HIDE_GITHUB_LINK ?? siteSettings?.HIDE_GITHUB_LINK) === 'true';

  // iPad/iOS: avoid min-h-screen + items-center — when the keyboard opens the visual
  // viewport shrinks, flex re-centers the form, Safari blurs the field, and the keyboard
  // dismisses. Top-align with padding keeps the focused input stable.
  return (
    <div className="min-h-[100dvh] bg-gray-100 dark:bg-gray-900 flex items-start justify-center pt-16 pb-12 px-4 sm:px-6 lg:px-8 relative">
      {/* Utilities — top right (matches app header: GitHub + language) */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        {!hideGithubLink && (
          <a
            href={AGILA_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-full transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
            title={tCommon('navigation.github')}
            aria-label={tCommon('navigation.github')}
          >
            <Github size={20} />
          </a>
        )}
        <button
          onClick={handleLanguageToggle}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors border border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500"
          title={currentLanguage === 'en' ? 'Switch to French' : 'Passer en anglais'}
        >
          {currentLanguage === 'en' ? 'FR' : 'EN'}
        </button>
      </div>
      
      <div className="max-w-md w-full space-y-8">
        <div>
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={siteName || 'Agila'}
              className="mx-auto h-12 w-auto max-w-[220px] object-contain"
            />
          ) : null}
          <h2 className={`${logoSrc ? 'mt-6' : ''} text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100`}>
            {t('login.signInToAccount')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            {t('login.welcome')}
          </p>
        </div>
        
        {/* Backend Unavailable Message */}
        {!backendAvailable && !checkingBackend && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-600 p-6 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-yellow-400 dark:text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {t('login.systemUnavailable')}
                </h3>
                <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                  <p>
                    {t('login.systemUnavailableMessage')}
                  </p>
                  <p className="mt-2">
                    {t('login.systemUnavailableContact')}
                  </p>
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-yellow-800 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-900/40 hover:bg-yellow-200 dark:hover:bg-yellow-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                  >
                    <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {t('login.retryConnection')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading Spinner while checking backend — keep form unmounted until done so
            removing this banner cannot steal focus / dismiss the iOS keyboard. */}
        {checkingBackend && (
          <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 dark:border-blue-600 p-6 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="animate-spin h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  {t('login.connectingToServer')}
                </p>
              </div>
            </div>
          </div>
        )}
        
        {!checkingBackend && backendAvailable && (
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {!isDemoMode && (
            <div className="rounded-md shadow-sm -space-y-px bg-white dark:bg-gray-800 p-6 rounded-lg">
              <div>
                <label htmlFor="email" className="sr-only">
                  {t('login.emailAddress')}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder={t('login.emailAddress')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">
                  {t('login.password')}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder={t('login.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          )}

          {isDemoMode && (
            <div className="relative rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4 shadow-sm dark:border-blue-800 dark:from-blue-950/50 dark:via-gray-900 dark:to-indigo-950/40">
              <div
                className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-blue-400/15 blur-2xl dark:bg-blue-500/10"
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 inline-flex rounded-lg bg-blue-600 p-1.5 text-white shadow-sm">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {t('login.demoCredentials')}
                    </p>
                    <p className="mt-0.5 text-xs text-blue-800/80 dark:text-blue-200/80">
                      {credentialsReady
                        ? t('login.demoGuideHint')
                        : t('login.demoCredentialsWaitingHint')}
                    </p>
                  </div>
                </div>

                {!credentialsReady && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                      <RefreshCw
                        className={`h-4 w-4 ${
                          waitingForCredentials || refreshingCredentials ? 'animate-spin' : ''
                        }`}
                      />
                      <span className="text-xs font-medium">
                        {t('login.demoCredentialsWaiting')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshCredentials}
                      disabled={refreshingCredentials}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300"
                      title={t('login.refreshCredentials')}
                      aria-label={t('login.refreshCredentials')}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${refreshingCredentials ? 'animate-spin' : ''}`}
                      />
                      {refreshingCredentials
                        ? t('login.refreshingCredentials')
                        : t('login.refreshCredentials')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="space-y-2 text-center">
              <div className="text-sm text-red-600 dark:text-red-400">{errorMessage}</div>
              {isDemoMode && errorKey === 'login.demoSignInFailedRefresh' && (
                <button
                  type="button"
                  onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                  }}
                  className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
                >
                  {t('login.clearSession')}
                </button>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="relative">
              {isDemoMode && credentialsReady && !isLoading && (
                <div
                  className="demo-guide-cue absolute -top-1 left-1/2 z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center text-blue-600 dark:text-blue-300"
                  aria-hidden
                >
                  <MousePointerClick className="h-5 w-5 drop-shadow-sm" />
                </div>
              )}
              <button
                type="submit"
                disabled={isLoading || (isDemoMode && !credentialsReady)}
                className={`group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-semibold rounded-lg text-white ${
                  isLoading || (isDemoMode && !credentialsReady)
                    ? 'bg-blue-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                } ${
                  isDemoMode && credentialsReady && !isLoading ? 'demo-guide-target' : ''
                }`}
              >
                {isLoading ? (
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                ) : null}
                {isLoading ? t('login.loading') : t('login.submit')}
              </button>
            </div>

            {/* Google Sign-In Button - Only show if OAuth is configured (non-demo) */}
            {googleOAuthEnabled && !isDemoMode && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {t('login.signInWithGoogle')}
              </button>
            )}
          </div>

          {/* Forgot Password Link — hidden in demo (no outbound email) */}
          {onForgotPassword && !isDemoMode && (
            <div className="text-center">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-blue-600 hover:text-blue-500 underline"
              >
                {t('login.forgotYourPassword')}
              </button>
            </div>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline dark:text-gray-400 dark:hover:text-gray-200"
            >
              {t('login.clearSession')}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
