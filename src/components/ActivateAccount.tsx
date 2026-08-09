import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { login } from '../api';
import { setExplicitGuestLanguage } from '../utils/guestLanguage';
import { useSettings } from '../contexts/SettingsContext';
import { resolvePublicBrandLogoSrc } from '../utils/brandLogo';

function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

interface ActivateAccountProps {
  token: string;
  email: string;
  onBackToLogin: () => void;
  onAutoLogin: (user: any, token: string) => Promise<void>;
  isLoading?: boolean;
}

export default function ActivateAccount({ token, email, onBackToLogin, onAutoLogin, isLoading: isLoadingProps }: ActivateAccountProps) {
  const { t, i18n } = useTranslation('auth');
  const { siteSettings } = useSettings();
  const [theme, setTheme] = useState<'light' | 'dark'>(readDocumentTheme);
  const logoSrc = resolvePublicBrandLogoSrc(siteSettings, theme);
  const siteName = String(siteSettings?.SITE_NAME ?? '').trim();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [success, setSuccess] = useState(false);
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false);

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

  const currentLanguage = (i18n.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const handleLanguageToggle = async () => {
    const newLanguage = currentLanguage === 'en' ? 'fr' : 'en';
    setExplicitGuestLanguage(newLanguage);
    await i18n.changeLanguage(newLanguage);
  };

  const languageToggle = (
    <button
      type="button"
      onClick={handleLanguageToggle}
      className="absolute top-4 right-4 px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-50 rounded-md transition-colors border border-gray-300 hover:border-blue-400 z-10"
      title={currentLanguage === 'en' ? 'Switch to French' : 'Passer en anglais'}
    >
      {currentLanguage === 'en' ? 'FR' : 'EN'}
    </button>
  );

  // Debug props to server console - DISABLED
  // React.useEffect(() => {
  //   fetch('/api/debug/log', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ 
  //       message: '🔍 ActivateAccount props', 
  //       data: { 
  //         token: token ? token.substring(0, 10) + '...' : 'missing', 
  //         email: email || 'missing' 
  //       } 
  //     })
  //   }).catch(() => {});
  // }, [token, email]);

  // Check if Google OAuth is configured
  useEffect(() => {
    const checkGoogleOAuth = async () => {
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const settings = await response.json();
          setGoogleOAuthEnabled(!!settings.GOOGLE_CLIENT_ID);
        }
      } catch (error) {
        console.warn('Could not check Google OAuth status:', error);
      }
    };
    
    checkGoogleOAuth();
  }, []);

  const translateVerifyError = (backendMessage: string): string => {
    const messageMap: Record<string, string> = {
      'Token and email are required': 'activateAccount.missingTokenOrEmail',
      'Invalid or expired invitation token': 'activateAccount.linkExpired',
      'Invitation token has expired': 'activateAccount.invitationExpired',
      'Account is already active': 'activateAccount.accountAlreadyActive',
      'Failed to verify invitation token': 'activateAccount.failedToVerifyToken',
      'Too many invitation checks, please try again in 1 hour': 'activateAccount.tooManyChecks',
      'Too many activation attempts, please try again in 1 hour': 'activateAccount.tooManyAttempts',
    };
    const key = messageMap[backendMessage];
    return key ? t(key) : backendMessage || t('activateAccount.failedToVerifyToken');
  };

  // Verify invitation token on mount — before showing the password form
  useEffect(() => {
    if (isLoadingProps) {
      return;
    }

    if (!token || !email) {
      setTokenValid(false);
      setError(t('activateAccount.missingTokenOrEmail'));
      return;
    }

    let cancelled = false;

    const verifyToken = async () => {
      try {
        const params = new URLSearchParams({
          token,
          email: decodeURIComponent(email)
        });
        const response = await fetch(`/api/auth/verify-invitation?${params.toString()}`);
        const data = await response.json().catch(() => ({}));

        if (cancelled) return;

        if (response.ok && data.valid) {
          setTokenValid(true);
          setError('');
          return;
        }

        setTokenValid(false);
        setError(translateVerifyError(data.error || ''));
      } catch {
        if (cancelled) return;
        setTokenValid(false);
        setError(t('activateAccount.failedToVerifyToken'));
      }
    };

    setTokenValid(null);
    verifyToken();
    return () => {
      cancelled = true;
    };
  }, [token, email, isLoadingProps, t]);

  const handleGoogleSignIn = async () => {
    if (!googleOAuthEnabled) {
      setError(t('activateAccount.googleOAuthNotConfigured'));
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      // Store activation context in localStorage so we can handle it after OAuth
      localStorage.setItem('activationContext', JSON.stringify({ token, email }));
      
      // Redirect to Google OAuth
      const response = await fetch('/api/auth/google/url');
      if (response.ok) {
        const { url } = await response.json();
        window.location.href = url;
      } else {
        throw new Error('Failed to get Google OAuth URL');
      }
    } catch (error: any) {
      setError(t('activateAccount.googleSignInFailed'));
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (password.length < 6) {
      setError(t('activateAccount.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('activateAccount.passwordsDoNotMatch'));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/activate-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          token, 
          email: decodeURIComponent(email),
          newPassword: password 
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        
        // Account activation successful, now perform normal login with new password
        try {
          const loginResponse = await login(decodeURIComponent(email), password);
          // Auto-login the user
          setTimeout(() => {
            onAutoLogin(loginResponse.user, loginResponse.token);
          }, 2000); // Show success message for 2 seconds before redirecting
        } catch (loginError) {
          console.warn('Auto-login after activation failed:', loginError);
          // If auto-login fails, show success and let user login manually
          setTimeout(() => {
            onBackToLogin();
          }, 3000);
        }
      } else {
        setError(
          data.error
            ? translateVerifyError(data.error)
            : t('activateAccount.failedToActivate')
        );
      }
    } catch (error) {
      setError(t('activateAccount.networkError'));
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while waiting for token verification
  if (tokenValid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 relative">
        {languageToggle}
        <div className="max-w-md w-full text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('activateAccount.verifyingToken')}</p>
        </div>
      </div>
    );
  }

  // Invalid token state
  if (tokenValid === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 relative">
        {languageToggle}
        <div className="max-w-md w-full text-center">
          <div className="mx-auto h-12 w-12 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">{t('activateAccount.invalidLink')}</h2>
          <p className="mt-2 text-gray-600">
            {error || t('activateAccount.linkExpired')}
          </p>
          <button
            onClick={onBackToLogin}
            className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('activateAccount.backToLogin')}
          </button>
        </div>
      </div>
    );
  }

  // Loading state while props are being parsed
  if (isLoadingProps) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 relative">
        {languageToggle}
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('activateAccount.loading')}</h2>
          <p className="text-gray-600">
            {t('activateAccount.processingLink')}
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 relative">
        {languageToggle}
        <div className="max-w-md w-full text-center">
          <div className="mx-auto h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">{t('activateAccount.accountActivated')}</h2>
          <p className="mt-2 text-gray-600">
            {t('activateAccount.activationSuccess')}
          </p>
          <div className="mt-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        </div>
      </div>
    );
  }

  // Main activation form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
      {languageToggle}
      <div className="max-w-md w-full space-y-8">
        <div>
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={siteName || 'Agila'}
              className="mx-auto h-12 w-auto max-w-[220px] object-contain"
            />
          ) : null}
          <h2 className={`${logoSrc ? 'mt-6' : ''} text-center text-3xl font-extrabold text-gray-900`}>
            {t('activateAccount.title')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t('activateAccount.description')}
          </p>
          <p className="mt-1 text-center text-sm text-gray-500">
            {t('activateAccount.accountLabel', { email: decodeURIComponent(email) })}
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                {t('activateAccount.newPassword')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  className="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder={t('activateAccount.newPasswordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password Field */}
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                {t('activateAccount.confirmPassword')}
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  className="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder={t('activateAccount.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Password Requirements */}
          <div className="text-xs text-gray-500">
            {t('activateAccount.passwordRequirement')}
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-700">
                {error}
              </div>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : null}
              {isLoading ? t('activateAccount.activating') : t('activateAccount.submit')}
            </button>
          </div>
        </form>

        {/* Google Sign-In Option */}
        {googleOAuthEnabled && (
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">{t('activateAccount.or')}</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {isLoading ? t('activateAccount.connecting') : t('activateAccount.continueWithGoogle')}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onBackToLogin}
            className="inline-flex items-center text-sm text-blue-600 hover:text-blue-500"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('activateAccount.backToLogin')}
          </button>
        </div>
      </div>
    </div>
  );
}
