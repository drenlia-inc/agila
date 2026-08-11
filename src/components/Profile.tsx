import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Trash2 } from 'lucide-react';
import { uploadAvatar, deleteAccount, getUserSettings } from '../api';
import {
  loadUserPreferences,
  loadUserPreferencesAsync,
  updateUserPreference,
  updateAppSettingsPreference,
  type UserPreferences,
} from '../utils/userPreferences';
import api from '../api';
import { getAuthenticatedAvatarUrl } from '../utils/authImageUrl';
import { useSettings } from '../contexts/SettingsContext';
import ProfileDevTab from './profile/ProfileDevTab';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { setExplicitGuestLanguage } from '../utils/guestLanguage';
import { userIsViewer } from '../utils/permissions';

type NotificationPreferenceKey = keyof UserPreferences['notifications'];

const NOTIFICATION_PREF_KEYS: NotificationPreferenceKey[] = [
  'newTaskAssigned',
  'myTaskUpdated',
  'watchedTaskUpdated',
  'addedAsCollaborator',
  'addedAsWatcher',
  'collaboratingTaskUpdated',
  'commentAdded',
  'requesterTaskCreated',
  'requesterTaskUpdated',
];

interface ProfileProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
  onProfileUpdated: () => void;
  isProfileBeingEdited: boolean;
  onProfileEditingChange: (isEditing: boolean) => void;
  onActivityFeedToggle?: (enabled: boolean) => void;
  onAccountDeleted?: () => void;
  /** Field to focus when the modal opens (default: display name). */
  initialFocus?: 'displayName' | 'bio';
}

export default function Profile({ isOpen, onClose, currentUser, onProfileUpdated, isProfileBeingEdited, onProfileEditingChange, onActivityFeedToggle, onAccountDeleted, initialFocus = 'displayName' }: ProfileProps) {
  const { t, i18n } = useTranslation('common');
  const { systemSettings: contextSystemSettings, siteSettings } = useSettings(); // Use SettingsContext instead of fetching
  const aiEnabled = siteSettings?.AI_ENABLED === 'true' || contextSystemSettings?.AI_ENABLED === 'true';
  const isViewOnlyUser = userIsViewer(currentUser);
  const [activeTab, setActiveTab] = useState<'profile' | 'app-settings' | 'notifications' | 'dev'>('profile');
  const [displayName, setDisplayName] = useState(currentUser?.firstName + ' ' + currentUser?.lastName || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [systemSettings, setSystemSettings] = useState<{
    TASK_DELETE_CONFIRM?: string;
    SHOW_ACTIVITY_FEED?: string;
    MAIL_ENABLED?: string;
    ALLOW_USER_SELF_DELETE?: string;
  }>({});
  const [userSettings, setUserSettings] = useState<{ showActivityFeed?: boolean }>({});
  const [userPrefs, setUserPrefs] = useState(loadUserPreferences(currentUser?.id));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Account deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  
  // Refs for focus management
  const displayNameRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const deleteConfirmationRef = useRef<HTMLInputElement>(null);
  
  // Track original values to detect changes
  const [originalDisplayName, setOriginalDisplayName] = useState(currentUser?.displayName || currentUser?.firstName + ' ' + currentUser?.lastName || '');
  const [originalBio, setOriginalBio] = useState(currentUser?.bio || '');
  const [originalAvatarUrl, setOriginalAvatarUrl] = useState(currentUser?.googleAvatarUrl || currentUser?.avatarUrl || '');

  // Load system settings when modal opens - use SettingsContext instead of fetching
  useEffect(() => {
    if (isOpen && contextSystemSettings) {
      // Use settings from SettingsContext instead of fetching
      setSystemSettings(contextSystemSettings);
    }
  }, [isOpen, contextSystemSettings]);

  // Load user settings when system settings are available
  useEffect(() => {
    const loadUserSettings = async () => {
      if (isOpen && Object.keys(systemSettings).length > 0) {
        try {
          // Load unified preferences (cookie + database)
          const unifiedPrefs = await loadUserPreferencesAsync(currentUser?.id);
          setUserPrefs(unifiedPrefs);
          
          // Also load database-only settings for backwards compatibility
          const settings = await getUserSettings();
          // Use system defaults for any settings not explicitly set by user
          const settingsWithDefaults = {
            showActivityFeed: unifiedPrefs.appSettings.showActivityFeed !== undefined 
              ? unifiedPrefs.appSettings.showActivityFeed 
              : systemSettings.SHOW_ACTIVITY_FEED !== 'false', // Default to true unless system says false
            ...settings
          };
          setUserSettings(settingsWithDefaults);
        } catch (error) {
          console.error('Failed to load user settings:', error);
        }
      }
    };
    
    loadUserSettings();
  }, [isOpen, systemSettings, currentUser?.id]);

  // Reset form when modal opens (but not when currentUser changes during editing)
  useEffect(() => {
    if (isOpen && !isProfileBeingEdited) {
      const initialDisplayName = currentUser?.displayName || currentUser?.firstName + ' ' + currentUser?.lastName || '';
      const initialAvatarUrl = currentUser?.googleAvatarUrl || currentUser?.avatarUrl || '';
      const initialBio = currentUser?.bio || '';
      
      setDisplayName(initialDisplayName);
      setOriginalDisplayName(initialDisplayName);
      setBio(initialBio);
      setOriginalBio(initialBio);
      setOriginalAvatarUrl(initialAvatarUrl);
      setSelectedFile(null);
      setPreviewUrl(null);
      setError(null);
      setIsSubmitting(false);
      setActiveTab('profile'); // Reset to profile tab
      onProfileEditingChange(false); // Reset editing state when modal opens
    }
  }, [isOpen, onProfileEditingChange]); // Removed currentUser dependency to prevent resets during editing

  // Leave Dev tab if AI is off or user is view-only (no PATs / agent credentials)
  useEffect(() => {
    if (activeTab === 'dev' && (!aiEnabled || isViewOnlyUser)) {
      setActiveTab('profile');
    }
  }, [aiEnabled, isViewOnlyUser, activeTab]);

  // Monitor for changes to display name, bio, or avatar to set editing state
  useEffect(() => {
    if (isOpen) {
      const hasDisplayNameChanged = displayName.trim() !== originalDisplayName.trim();
      const hasBioChanged = bio.trim() !== originalBio.trim();
      const hasAvatarChanged = selectedFile !== null || 
        (currentUser?.authProvider === 'local' && !currentUser?.avatarUrl && originalAvatarUrl);

      const isEditing = hasDisplayNameChanged || hasBioChanged || hasAvatarChanged;
      onProfileEditingChange(isEditing);
    }
  }, [displayName, bio, selectedFile, originalDisplayName, originalBio, originalAvatarUrl, currentUser, isOpen, onProfileEditingChange]);

  // Focus the requested field when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (initialFocus === 'bio' && bioRef.current) {
        bioRef.current.focus();
        const len = bioRef.current.value.length;
        bioRef.current.setSelectionRange(len, len);
        return;
      }
      displayNameRef.current?.focus();
      displayNameRef.current?.select();
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen, initialFocus]);

  // Auto-focus delete confirmation field when it becomes visible
  useEffect(() => {
    if (showDeleteConfirm && deleteConfirmationRef.current) {
      const timer = setTimeout(() => {
        deleteConfirmationRef.current?.focus();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [showDeleteConfirm]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('File size must be less than 5MB');
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }

      setSelectedFile(file);
      setError(null);

      // Create preview URL
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      const newPreviewUrl = URL.createObjectURL(file);
      setPreviewUrl(newPreviewUrl);
    }
  };

  const handleRemoveFile = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Only call API for local users who have an existing avatar
      if (currentUser?.authProvider === 'local' && currentUser?.avatarUrl) {
        await api.delete('/users/avatar');
      }
      
      // Clear local state
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      
      // Call the callback to refresh user data
      onProfileUpdated();
      
    } catch (err: any) {
      setError(err.response?.data?.error || t('profile.failedToRemoveAvatar'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError(t('profile.displayNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await api.put('/users/profile', {
        displayName: displayName.trim(),
        bio: bio.trim()
      });
      
      // Handle avatar upload if needed
      if (currentUser?.authProvider === 'local' && selectedFile) {
        try {
          await uploadAvatar(selectedFile);
        } catch (avatarError) {
          console.error('❌ Avatar upload failed:', avatarError);
          // Don't show error to user since profile was already updated
        }
      }
      
      // Call the callback to refresh user data AFTER all updates
      onProfileUpdated();
      
      // Clear editing state after successful save
      onProfileEditingChange(false);
      
      // Close modal immediately
      onClose();
      
    } catch (err: any) {
      setError(err.response?.data?.error || t('profile.failedToUpdateProfile'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      // Clean up preview URL if exists
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      // Clear editing state when modal is manually closed
      onProfileEditingChange(false);
      onClose();
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') {
      setError(t('profile.pleaseTypeDelete'));
      return;
    }

    setIsDeletingAccount(true);
    setError(null);

    try {
      await deleteAccount();
      
      // Call the account deletion callback to handle logout and redirect
      if (onAccountDeleted) {
        onAccountDeleted();
      }
      
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          (err.response?.data?.code === 'self_delete_disabled'
            ? t('profile.selfDeleteDisabled')
            : t('profile.failedToDeleteAccount'))
      );
      setIsDeletingAccount(false);
    }
  };

  // App Settings handlers
  const handleTaskDeleteConfirmChange = (value: boolean | 'system') => {
    const nextValue = value === 'system' ? undefined : value;
    void updateAppSettingsPreference('taskDeleteConfirm', nextValue, currentUser?.id);
    setUserPrefs((prev) => ({
      ...prev,
      appSettings: { ...prev.appSettings, taskDeleteConfirm: nextValue },
    }));
  };

  const handleActivityFeedToggle = (enabled: boolean) => {
    // Optimistic UI: flip checkbox + hide/show feed immediately. Persisting via
    // updateUserPreference('appSettings') awaited a full prefs save and felt broken.
    setUserPrefs((prev) => ({
      ...prev,
      appSettings: { ...prev.appSettings, showActivityFeed: enabled },
    }));
    setUserSettings((prev) => ({ ...prev, showActivityFeed: enabled }));
    onActivityFeedToggle?.(enabled);

    void updateAppSettingsPreference('showActivityFeed', enabled, currentUser?.id).catch((error) => {
      console.error('Failed to update activity feed setting:', error);
      setError(t('profile.failedToUpdateActivityFeed'));
      setUserPrefs((prev) => ({
        ...prev,
        appSettings: { ...prev.appSettings, showActivityFeed: !enabled },
      }));
      setUserSettings((prev) => ({ ...prev, showActivityFeed: !enabled }));
      onActivityFeedToggle?.(!enabled);
    });
  };

  const handleLanguageChange = async (lang: 'en' | 'fr') => {
    try {
      await i18n.changeLanguage(lang);
      setExplicitGuestLanguage(lang);
      await updateUserPreference('language', lang, currentUser?.id);
      setUserPrefs((prev) => ({ ...prev, language: lang }));
    } catch (err) {
      console.error('Failed to update language preference:', err);
    }
  };

  const getCurrentTaskDeleteConfirmSetting = () => {
    const userPrefs = loadUserPreferences(currentUser?.id);
    
    // If user has explicitly set a preference, return that
    if (userPrefs.appSettings.taskDeleteConfirm !== undefined) {
      return userPrefs.appSettings.taskDeleteConfirm;
    }
    
    // Otherwise, return 'system' to indicate inheriting from system
    return 'system';
  };

  const handleEscape = useCallback(() => {
    if (isSubmitting || isDeletingAccount) return;
    if (showDeleteConfirm) {
      setShowDeleteConfirm(false);
      setDeleteConfirmation('');
      return;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    onProfileEditingChange(false);
    onClose();
  }, [isSubmitting, isDeletingAccount, showDeleteConfirm, previewUrl, onProfileEditingChange, onClose]);

  useEscapeDismiss(handleEscape, { enabled: isOpen });

  if (!isOpen) return null;

  const avatarClass = 'h-16 w-16 rounded-full object-cover shadow';

  // Function to get avatar display
  const getAvatarDisplay = () => {
    // Priority: File preview > Current avatar > Default initials
    if (previewUrl) {
      return (
        <img
          src={previewUrl}
          alt="Preview"
          className={avatarClass}
        />
      );
    }
    
    if (currentUser?.googleAvatarUrl) {
      return (
        <img
          src={getAuthenticatedAvatarUrl(currentUser.googleAvatarUrl)}
          alt="Profile"
          className={avatarClass}
        />
      );
    }
    
    if (currentUser?.avatarUrl) {
      return (
        <img
          src={getAuthenticatedAvatarUrl(currentUser.avatarUrl)}
          alt="Profile"
          className={avatarClass}
        />
      );
    }
    
    // Default initials avatar
    const initials = (currentUser?.firstName?.[0] || '') + (currentUser?.lastName?.[0] || '');
    return (
      <div className="h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white shadow bg-gradient-to-br from-blue-500 to-purple-600">
        {initials || 'U'}
      </div>
    );
  };

  const mailEnabled = systemSettings.MAIL_ENABLED === 'true';

  const setAllNotificationPrefs = (enabled: boolean) => {
    const notifications = NOTIFICATION_PREF_KEYS.reduce(
      (acc, key) => {
        acc[key] = enabled;
        return acc;
      },
      {} as UserPreferences['notifications']
    );
    const newPrefs = { ...userPrefs, notifications };
    setUserPrefs(newPrefs);
    updateUserPreference('notifications', notifications, currentUser?.id);
  };

  const setNotificationPref = (key: NotificationPreferenceKey, enabled: boolean) => {
    const notifications = {
      ...userPrefs.notifications,
      [key]: enabled,
    };
    const newPrefs = { ...userPrefs, notifications };
    setUserPrefs(newPrefs);
    updateUserPreference('notifications', notifications, currentUser?.id);
  };

  return (
    <div
      className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-[10030]"
      role="presentation"
      onClick={handleClose}
    >
      <div
        className="relative top-10 sm:top-16 mx-auto p-6 border w-[calc(100%-2rem)] max-w-2xl shadow-xl rounded-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="mt-3">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('profile.title')}</h3>
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('profile')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'profile'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t('profile.profileSettings')}
              </button>
              <button
                onClick={() => setActiveTab('app-settings')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'app-settings'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t('profile.appSettings')}
              </button>
              <button
                onClick={() => setActiveTab('notifications')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'notifications'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t('profile.notifications')}
              </button>
              {aiEnabled && !isViewOnlyUser && (
                <button
                  onClick={() => setActiveTab('dev')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'dev'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {t('profile.dev')}
                </button>
              )}
            </nav>
          </div>

          {/* Profile Tab Content */}
          {activeTab === 'profile' && (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Avatar + display name */}
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 relative">
                    {getAvatarDisplay()}
                    {currentUser?.authProvider === 'local' && (previewUrl || currentUser?.avatarUrl) && (
                      <button
                        type="button"
                        onClick={handleRemoveFile}
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors shadow"
                        title={t('profile.removeAvatar')}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('profile.displayName')}
                      </label>
                      <input
                        ref={displayNameRef}
                        type="text"
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={30}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        placeholder={t('profile.displayNamePlaceholder')}
                        required
                      />
                    </div>
                    {currentUser?.authProvider === 'local' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="avatar-upload"
                          ref={fileInputRef}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-xs font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
                        >
                          <Upload className="h-3.5 w-3.5 mr-1.5" />
                          {currentUser?.avatarUrl || previewUrl ? t('profile.changePhoto') : t('profile.uploadPhoto')}
                        </button>
                        <span className="text-xs text-gray-500">{t('profile.photoFormatHint')}</span>
                      </div>
                    )}
                  </div>
                </div>

                {currentUser?.authProvider !== 'local' && (
                  <p className="text-xs text-gray-500 -mt-2">
                    {t('profile.profilePictureManagedBrief', {
                      provider: currentUser?.authProvider === 'google' ? 'Google' : 'SSO',
                    })}
                  </p>
                )}

                {/* Bio */}
                <div>
                  <label htmlFor="profileBio" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('profile.bio')}
                  </label>
                  <textarea
                    ref={bioRef}
                    id="profileBio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 280))}
                    maxLength={280}
                    rows={5}
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-y min-h-[7.5rem]"
                    placeholder={t('profile.bioPlaceholder')}
                  />
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
                    <p>{t('profile.bioHint')}</p>
                    <span className="shrink-0 tabular-nums">{bio.trim().length}/280</span>
                  </div>
                </div>

                {/* Error Display */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <div className="text-sm text-red-600">{error}</div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                      isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {isSubmitting ? t('profile.saving') : t('profile.saveChanges')}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                  >
                    {t('buttons.cancel')}
                  </button>
                </div>
              </form>

              {/* Danger Zone - Account Deletion */}
              {systemSettings.ALLOW_USER_SELF_DELETE !== 'false' ? (
              <div className="mt-8 pt-6 border-t border-red-200">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-red-800 mb-2 flex items-center">
                    <Trash2 className="h-5 w-5 mr-2" />
                    {t('profile.dangerZone')}
                  </h3>
                  <p className="text-sm text-red-700 mb-4">
                    {t('profile.deleteAccountWarning')}
                  </p>
                  
                  {!showDeleteConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isSubmitting || isDeletingAccount}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors text-sm font-medium"
                    >
                      {t('profile.deleteMyAccount')}
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-red-100 border border-red-300 rounded-md p-3">
                        <p className="text-sm text-red-800 font-medium mb-2">
                          {t('profile.deleteAccountPermanent')}
                        </p>
                        <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
                          <li>{t('profile.deleteAccountList1')}</li>
                          <li>{t('profile.deleteAccountList2')}</li>
                          <li>{t('profile.deleteAccountList3')}</li>
                          <li>{t('profile.deleteAccountList4')}</li>
                        </ul>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-red-800 mb-2">
                            {t('profile.typeDeleteToConfirm')}
                          </label>
                          <input
                            ref={deleteConfirmationRef}
                            type="text"
                            value={deleteConfirmation}
                            onChange={(e) => setDeleteConfirmation(e.target.value)}
                            className="w-full px-3 py-2 border border-red-300 dark:border-red-600 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            placeholder={t('profile.typeDeletePlaceholder')}
                            disabled={isDeletingAccount}
                          />
                        </div>
                        
                        {error && (
                          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                            {error}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex space-x-3">
                        <button
                          type="button"
                          onClick={handleDeleteAccount}
                          disabled={deleteConfirmation !== 'DELETE' || isDeletingAccount}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteMyAccountForever')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowDeleteConfirm(false);
                            setDeleteConfirmation('');
                            setError(null);
                          }}
                          disabled={isDeletingAccount}
                          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors text-sm"
                        >
                          {t('buttons.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              ) : (
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60 p-4">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
                    {t('profile.dangerZone')}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {t('profile.selfDeleteDisabled')}
                  </p>
                </div>
              </div>
              )}
            </>
          )}

          {/* App Settings Tab Content */}
          {activeTab === 'app-settings' && (
            <div className="space-y-6">
              <div>
                <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">{t('profile.applicationPreferences')}</h4>
                <p className="text-sm text-gray-600 mb-6">
                  {t('profile.appPreferencesDescription')}
                </p>
              </div>

              {/* Task Delete Confirmation — hidden for view-only (cannot delete tasks) */}
              {!isViewOnlyUser && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      {t('profile.taskDeleteConfirmation')}
                    </label>
                    <p className="text-sm text-gray-500">
                      {t('profile.taskDeleteConfirmationDescription')}
                      {systemSettings.TASK_DELETE_CONFIRM !== 'false' ? ` ${t('profile.systemDefaultEnabled')}` : ` ${t('profile.systemDefaultDisabled')}`}
                    </p>
                  </div>
                  <div className="ml-6 flex-shrink-0">
                    <select
                      value={(() => {
                        const current = getCurrentTaskDeleteConfirmSetting();
                        return current === 'system' ? 'system' : current.toString();
                      })()}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === 'system') {
                          handleTaskDeleteConfirmChange('system');
                        } else {
                          handleTaskDeleteConfirmChange(value === 'true');
                        }
                      }}
                      className="block w-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      <option value="system">{t('profile.useSystemDefault')}</option>
                      <option value="true">{t('profile.alwaysConfirm')}</option>
                      <option value="false">{t('profile.neverConfirm')}</option>
                    </select>
                  </div>
                </div>
              </div>
              )}

              {/* Preferred Language */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      {t('profile.preferredLanguage')}
                    </label>
                    <p className="text-sm text-gray-500">
                      {t('profile.preferredLanguageDescription')}
                    </p>
                  </div>
                  <div className="ml-6 flex-shrink-0">
                    <select
                      value={userPrefs.language === 'fr' ? 'fr' : 'en'}
                      onChange={(e) =>
                        handleLanguageChange(e.target.value === 'fr' ? 'fr' : 'en')
                      }
                      className="block w-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      <option value="en">{t('profile.languageEnglish')}</option>
                      <option value="fr">{t('profile.languageFrench')}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Activity Feed Setting */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      {t('profile.activityFeed')}
                    </label>
                    <p className="text-sm text-gray-500">
                      {t('profile.activityFeedDescription')}
                      {systemSettings.SHOW_ACTIVITY_FEED !== 'false' ? ` ${t('profile.systemDefaultEnabled')}` : ` ${t('profile.systemDefaultDisabled')}`}
                    </p>
                  </div>
                  <div className="ml-6 flex-shrink-0">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={userSettings.showActivityFeed || false}
                        onChange={(e) => handleActivityFeedToggle(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-500 italic">
                {t('profile.changesSavedAutomatically')}
              </div>
            </div>
          )}

          {/* Notifications Tab Content */}
          {activeTab === 'notifications' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">{t('profile.emailNotifications')}</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {t('profile.emailNotificationsDescription')}
                  </p>
                </div>
                {mailEnabled && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setAllNotificationPrefs(true)}
                      className="px-2 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      {t('profile.enableAllNotifications')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllNotificationPrefs(false)}
                      className="px-2 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      {t('profile.disableAllNotifications')}
                    </button>
                  </div>
                )}
              </div>

              {!mailEnabled ? (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md px-3 py-2">
                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">{t('profile.emailServerDisabled')}</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-0.5">
                    {t('profile.emailServerDisabledDescription')}
                  </p>
                </div>
              ) : null}

              <div className={`${!mailEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">{t('profile.notifyMeWhen')}</div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-600 rounded-md">
                  {NOTIFICATION_PREF_KEYS.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-3 px-3 py-1.5 bg-white dark:bg-gray-800">
                      <label htmlFor={`notify-${key}`} className="text-sm text-gray-800 dark:text-gray-200 cursor-pointer min-w-0">
                        {t(`profile.${key}`)}
                      </label>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          id={`notify-${key}`}
                          type="checkbox"
                          checked={userPrefs.notifications?.[key] || false}
                          onChange={(e) => setNotificationPref(key, e.target.checked)}
                          className="sr-only peer"
                          disabled={!mailEnabled}
                        />
                        <div className="relative w-9 h-5 bg-gray-200 rounded-full peer peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 peer-checked:after:border-white"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs text-gray-500 italic">
                {t('profile.changesSavedAutomatically')}
              </div>
            </div>
          )}

          {activeTab === 'dev' && aiEnabled && !isViewOnlyUser && (
            <div className="space-y-6">
              <ProfileDevTab />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}