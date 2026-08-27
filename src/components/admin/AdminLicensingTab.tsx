import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, Users, ClipboardList, Layout, HardDrive, Shield, ExternalLink, Webhook } from 'lucide-react';
import api from '../../api';
import { buildCustomerPortalUrl } from '../../utils/customerPortalUrl';
import { adminSubNavTabClass } from './AdminSection';

interface BoardTaskCount {
  id: string;
  title: string;
  taskCount: number;
}

interface LicenseInfo {
  enabled: boolean;
  limits: {
    USER_LIMIT: number;
    TASK_LIMIT: number;
    BOARD_LIMIT: number;
    STORAGE_LIMIT: number;
    WEBHOOK_LIMIT?: number;
    SUPPORT_LEVEL?: string;
    /** @deprecated legacy alias — prefer SUPPORT_LEVEL */
    SUPPORT_TYPE?: string;
    AI_TIER?: string;
  };
  usage: {
    users: number;
    boards: number;
    totalTasks: number;
    storage: number;
    webhooks?: number;
  };
  limitsReached: {
    users: boolean;
    boards: boolean;
    storage: boolean;
    webhooks?: boolean;
  };
  boardTaskCounts?: BoardTaskCount[];
  message?: string;
  error?: string;
}

function resolveSupportLevel(limits: LicenseInfo['limits'] | undefined): string {
  return String(limits?.SUPPORT_LEVEL || limits?.SUPPORT_TYPE || 'basic');
}

interface AdminLicensingTabProps {
  currentUser: any;
  settings: any;
}

const AdminLicensingTab: React.FC<AdminLicensingTabProps> = ({ currentUser, settings }) => {
  const { t, i18n } = useTranslation('admin');
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'subscription'>('overview');
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buildTime, setBuildTime] = useState<string | null>(null);
  
  // Subscription management state
  const [isOwner, setIsOwner] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState<string>('');

  useEffect(() => {
    fetchLicenseInfo();
    checkOwnership();
    fetchBuildTime();
  }, []);

  const fetchBuildTime = async () => {
    try {
      const response = await fetch('/api/version', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.buildTime) {
        setBuildTime(data.buildTime);
      }
    } catch (err) {
      console.error('Failed to fetch build time:', err);
    }
  };

  // Fetch WEBSITE_URL - check settings prop first, then fetch directly if needed
  useEffect(() => {
    const fetchWebsiteUrl = async () => {
      try {
        // First check if it's in the settings prop
        if (settings?.WEBSITE_URL) {
          setWebsiteUrl(settings.WEBSITE_URL);
          return;
        }
        
        // If not in settings prop, fetch it directly
        const response = await api.get('/admin/settings');
        const allSettings = response.data || {};
        if (allSettings.WEBSITE_URL) {
          setWebsiteUrl(allSettings.WEBSITE_URL);
        } else {
          console.warn('WEBSITE_URL not found in settings');
          setWebsiteUrl('');
        }
      } catch (err) {
        console.error('Failed to fetch WEBSITE_URL:', err);
        setWebsiteUrl('');
      }
    };

    fetchWebsiteUrl();
  }, [settings]);

  // Initialize activeSubTab from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#admin#licensing#subscription') {
      setActiveSubTab('subscription');
    } else if (hash === '#admin#licensing#overview') {
      setActiveSubTab('overview');
    }
  }, []);

  // Update URL hash when activeSubTab changes
  const handleSubTabChange = (tab: 'overview' | 'subscription') => {
    setActiveSubTab(tab);
    const newHash = tab === 'subscription' 
      ? '#admin#licensing#subscription' 
      : '#admin#licensing#overview';
    window.location.hash = newHash;
  };

  // Listen for hash changes (back/forward navigation)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#admin#licensing#subscription') {
        setActiveSubTab('subscription');
      } else if (hash === '#admin#licensing#overview') {
        setActiveSubTab('overview');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const checkOwnership = async () => {
    try {
      const response = await api.get('/admin/owner');
      setIsOwner(response.data.owner === currentUser?.email);
    } catch (err) {
      console.error('Failed to check ownership:', err);
      setIsOwner(false);
    }
  };

  const fetchLicenseInfo = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/auth/license-info');
      setLicenseInfo(response.data);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || t('licensing.errorLoadingLicenseInfo', { error: err.message || 'Unknown error' });
      setError(errorMessage);
      // Also show toast for better visibility
      const { toast } = await import('../../utils/toast');
      toast.error(errorMessage, '');
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === -1) return t('licensing.unlimited');
    if (bytes === 0) return `0 ${t('licensing.bytes')}`;
    const k = 1024;
    const sizes = [
      t('licensing.bytes'),
      t('licensing.kb'),
      t('licensing.mb'),
      t('licensing.gb'),
      t('licensing.tb')
    ];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getSupportTypeColor = (supportType: string): string => {
    switch (String(supportType || '').toLowerCase()) {
      case 'pro':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'basic':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'free':
      case 'community':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const getSupportTypeIcon = (supportType: string) => {
    switch (String(supportType || '').toLowerCase()) {
      case 'pro':
        return <Shield className="h-4 w-4" />;
      case 'basic':
        return <CheckCircle className="h-4 w-4" />;
      case 'free':
      case 'community':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const calculateUsagePercentage = (current: number, limit: number): number => {
    if (limit === -1) return 0; // Unlimited
    return Math.min((current / limit) * 100, 100);
  };

  const renderOverviewContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <p className="text-red-800 dark:text-red-200">{t('licensing.errorLoadingLicenseInfo', { error })}</p>
          </div>
        </div>
      );
    }

    if (!licenseInfo) {
      return (
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-gray-600 dark:text-gray-400">{t('licensing.noLicenseInfoAvailable')}</p>
        </div>
      );
    }

    // Handle API errors
    if (licenseInfo.error) {
      return (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <p className="text-red-800 dark:text-red-200">{t('licensing.errorLoadingLicenseInfo', { error: licenseInfo.error })}</p>
          </div>
        </div>
      );
    }

    // Handle case where license info doesn't have the expected structure
    if (!licenseInfo.usage || !licenseInfo.limits) {
      return (
        <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-yellow-400 mr-2" />
            <p className="text-yellow-800 dark:text-yellow-200">
              {licenseInfo.message || t('licensing.licenseInfoIncomplete')}
            </p>
          </div>
        </div>
      );
    }

    if (!licenseInfo.enabled) {
      const isDemoMode = process.env.DEMO_ENABLED === 'true';
      return (
        <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-6">
          <div className="flex items-center">
            <CheckCircle className="h-6 w-6 text-blue-500 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-200">
                {isDemoMode ? t('licensing.demoMode') : t('licensing.selfHostedMode')}
              </h3>
              <p className="text-blue-700 dark:text-blue-300 mt-1">
                {isDemoMode 
                  ? t('licensing.demoModeDescription')
                  : t('licensing.selfHostedModeDescription')
                }
              </p>
            </div>
          </div>
        </div>
      );
    }

    const supportLevel = resolveSupportLevel(licenseInfo.limits);

    return (
      <div className="space-y-6">
        {/* Plan Information */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-6">
            <h3 className="text-lg font-semibold flex items-center mb-4 text-gray-900 dark:text-white">
              <Shield className="h-5 w-5 mr-2" />
              {t('licensing.currentPlan')}
            </h3>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {getSupportTypeIcon(supportLevel)}
                <div>
                  <h3 className="text-xl font-semibold capitalize text-gray-900 dark:text-white">{supportLevel} {t('licensing.plan')}</h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {supportLevel.toLowerCase() === 'pro' && t('licensing.proPlanDescription')}
                    {supportLevel.toLowerCase() === 'basic' && t('licensing.basicPlanDescription')}
                    {(supportLevel.toLowerCase() === 'free' || supportLevel.toLowerCase() === 'community') &&
                      t('licensing.freePlanDescription')}
                  </p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getSupportTypeColor(supportLevel)}`}>
                {supportLevel.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Usage Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Users */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-6">
              <h3 className="text-sm font-medium flex items-center mb-3 text-gray-900 dark:text-white">
                <Users className="h-4 w-4 mr-2" />
                {t('licensing.users')}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{licenseInfo.usage.users}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    / {licenseInfo.limits.USER_LIMIT === -1 ? '∞' : licenseInfo.limits.USER_LIMIT}
                  </span>
                </div>
                {licenseInfo.limits.USER_LIMIT !== -1 && (
                  <>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-in-out"
                        style={{ transform: `translateX(-${100 - calculateUsagePercentage(licenseInfo.usage.users, licenseInfo.limits.USER_LIMIT)}%)` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {t('licensing.percentageUsed', { percentage: calculateUsagePercentage(licenseInfo.usage.users, licenseInfo.limits.USER_LIMIT).toFixed(1) })}
                      </span>
                      {licenseInfo.limitsReached.users && (
                        <span className="text-red-500 font-medium">{t('licensing.limitReached')}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Boards */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-6">
              <h3 className="text-sm font-medium flex items-center mb-3 text-gray-900 dark:text-white">
                <Layout className="h-4 w-4 mr-2" />
                {t('licensing.boards')}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{licenseInfo.usage.boards}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    / {licenseInfo.limits.BOARD_LIMIT === -1 ? '∞' : licenseInfo.limits.BOARD_LIMIT}
                  </span>
                </div>
                {licenseInfo.limits.BOARD_LIMIT !== -1 && (
                  <>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-in-out"
                        style={{ transform: `translateX(-${100 - calculateUsagePercentage(licenseInfo.usage.boards, licenseInfo.limits.BOARD_LIMIT)}%)` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {t('licensing.percentageUsed', { percentage: calculateUsagePercentage(licenseInfo.usage.boards, licenseInfo.limits.BOARD_LIMIT).toFixed(1) })}
                      </span>
                      {licenseInfo.limitsReached.boards && (
                        <span className="text-red-500 font-medium">{t('licensing.limitReached')}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Webhooks */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-6">
              <h3 className="text-sm font-medium flex items-center mb-3 text-gray-900 dark:text-white">
                <Webhook className="h-4 w-4 mr-2" />
                {t('licensing.webhooks')}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">
                    {licenseInfo.usage.webhooks ?? 0}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    /{' '}
                    {licenseInfo.limits.WEBHOOK_LIMIT === undefined ||
                    licenseInfo.limits.WEBHOOK_LIMIT === -1
                      ? '∞'
                      : licenseInfo.limits.WEBHOOK_LIMIT}
                  </span>
                </div>
                {licenseInfo.limits.WEBHOOK_LIMIT !== undefined &&
                  licenseInfo.limits.WEBHOOK_LIMIT !== -1 && (
                    <>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-in-out"
                          style={{
                            transform: `translateX(-${100 - calculateUsagePercentage(licenseInfo.usage.webhooks ?? 0, licenseInfo.limits.WEBHOOK_LIMIT)}%)`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t('licensing.percentageUsed', {
                            percentage: calculateUsagePercentage(
                              licenseInfo.usage.webhooks ?? 0,
                              licenseInfo.limits.WEBHOOK_LIMIT
                            ).toFixed(1),
                          })}
                        </span>
                        {licenseInfo.limitsReached.webhooks && (
                          <span className="text-red-500 font-medium">{t('licensing.limitReached')}</span>
                        )}
                      </div>
                    </>
                  )}
              </div>
            </div>
          </div>

          {/* Storage */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-6">
              <h3 className="text-sm font-medium flex items-center mb-3 text-gray-900 dark:text-white">
                <HardDrive className="h-4 w-4 mr-2" />
                {t('licensing.storage')}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{formatBytes(licenseInfo.usage.storage)}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    / {formatBytes(licenseInfo.limits.STORAGE_LIMIT)}
                  </span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-in-out"
                    style={{ transform: `translateX(-${100 - calculateUsagePercentage(licenseInfo.usage.storage, licenseInfo.limits.STORAGE_LIMIT)}%)` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">
                    {t('licensing.percentageUsed', { percentage: calculateUsagePercentage(licenseInfo.usage.storage, licenseInfo.limits.STORAGE_LIMIT).toFixed(1) })}
                  </span>
                  {licenseInfo.limitsReached.storage && (
                    <span className="text-red-500 font-medium">{t('licensing.limitReached')}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Task Limits */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-6">
            <h3 className="text-lg font-semibold flex items-center mb-4 text-gray-900 dark:text-white">
              <ClipboardList className="h-5 w-5 mr-2" />
              {t('licensing.taskLimitsPerBoard')}
            </h3>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {licenseInfo.limits.TASK_LIMIT === -1
                    ? t('licensing.unlimitedTasksPerBoard')
                    : t('licensing.tasksPerBoardLimit', { count: licenseInfo.limits.TASK_LIMIT })}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  {t('licensing.maxTasksPerBoardDescription')}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {licenseInfo.limits.TASK_LIMIT === -1 ? '∞' : licenseInfo.limits.TASK_LIMIT}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{t('licensing.perBoard')}</div>
              </div>
            </div>

            {/* Board Task Count Breakdown - Only show if not unlimited and we have data */}
            {licenseInfo.limits.TASK_LIMIT !== -1 && licenseInfo.boardTaskCounts && licenseInfo.boardTaskCounts.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {t('licensing.boardUsageBreakdown')}
                </h4>
                <div className="space-y-3">
                  {licenseInfo.boardTaskCounts.map((board) => {
                    const usagePercentage = calculateUsagePercentage(board.taskCount, licenseInfo.limits.TASK_LIMIT);
                    const isNearLimit = usagePercentage >= 80;
                    const isAtLimit = usagePercentage >= 100;
                    
                    return (
                      <div key={board.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {board.title}
                            </span>
                            <span className={`text-sm font-semibold ${
                              isAtLimit ? 'text-red-600' : 
                              isNearLimit ? 'text-yellow-600' : 
                              'text-gray-600 dark:text-gray-300'
                            }`}>
                              {board.taskCount} / {licenseInfo.limits.TASK_LIMIT}
                            </span>
                          </div>
                          <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                            <div
                              className={`h-full transition-all duration-300 ease-in-out ${
                                isAtLimit ? 'bg-red-500' : 
                                isNearLimit ? 'bg-yellow-500' : 
                                'bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {t('licensing.percentageUsed', { percentage: usagePercentage.toFixed(1) })}
                            </span>
                            {isAtLimit && (
                              <span className="text-xs text-red-600 font-medium">{t('licensing.limitReached')}</span>
                            )}
                            {isNearLimit && !isAtLimit && (
                              <span className="text-xs text-yellow-600 font-medium">{t('licensing.nearLimit')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Show message for unlimited plans */}
            {licenseInfo.limits.TASK_LIMIT === -1 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center text-gray-500 dark:text-gray-400">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  <span className="text-sm">{t('licensing.unlimitedTasksPerBoard')}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* License Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('licensing.licenseStatus')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('licensing.licenseSystem')}</span>
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  licenseInfo.enabled 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                }`}>
                  {licenseInfo.enabled ? t('licensing.managed') : t('licensing.selfManaged')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('licensing.planType')}</span>
                <span className="text-sm capitalize text-gray-900 dark:text-white">{supportLevel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('licensing.appVersion')}</span>
                <span className="text-sm text-gray-900 dark:text-white">{settings?.APP_VERSION || '0'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('licensing.lastUpdated')}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {buildTime ? new Date(buildTime).toLocaleString() : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSubscriptionContent = () => {
    if (!isOwner) {
      return (
        <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-6">
          <div className="flex items-center">
            <AlertCircle className="h-6 w-6 text-yellow-500 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200">
                {t('licensing.accessRestricted')}
              </h3>
              <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                {t('licensing.onlyOwnerCanAccess')}
              </p>
            </div>
          </div>
        </div>
      );
    }

    const hasWebsiteUrl = websiteUrl.trim() !== '';

    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('licensing.customerPortal')}</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('licensing.customerPortalDescription')}
            </p>
            
            {hasWebsiteUrl ? (
              <button
                onClick={() => {
                  // Check SITE_OPENS_NEW_TAB setting (default to true if not set)
                  const opensInNewTab = settings?.SITE_OPENS_NEW_TAB === undefined || settings?.SITE_OPENS_NEW_TAB === 'true';
                  const target = buildCustomerPortalUrl(websiteUrl, currentUser?.email, i18n.language);
                  if (opensInNewTab) {
                    window.open(target, '_blank', 'noopener,noreferrer');
                  } else {
                    window.location.href = target;
                  }
                }}
                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                {t('licensing.openCustomerPortal')}
                <ExternalLink className="ml-2 h-4 w-4" />
              </button>
            ) : (
              <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
                <div className="flex items-center">
                  <AlertCircle className="h-5 w-5 text-yellow-400 mr-2" />
                  <p className="text-yellow-800 dark:text-yellow-200">
                    {t('licensing.websiteUrlNotConfigured')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6" data-owner-setup="licensing-panel">
      {/* Sub-tab Navigation */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-4">
          <nav className="flex space-x-6" aria-label="Tabs">
            <button
              onClick={() => handleSubTabChange('overview')}
              className={adminSubNavTabClass(activeSubTab === 'overview')}
            >
              {t('licensing.overview')}
            </button>
            <button
              onClick={() => handleSubTabChange('subscription')}
              className={adminSubNavTabClass(activeSubTab === 'subscription')}
            >
              {t('licensing.manageSubscription')}
            </button>
          </nav>
          {activeSubTab === 'overview' && (
            <button
              onClick={fetchLicenseInfo}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('licensing.refresh')}
            </button>
          )}
        </div>
      </div>

      {/* Conditional Content Based on Active Sub-tab */}
      {activeSubTab === 'overview' ? renderOverviewContent() : renderSubscriptionContent()}
    </div>
  );
};

export default AdminLicensingTab;
