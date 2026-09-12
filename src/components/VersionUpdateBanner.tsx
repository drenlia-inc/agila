import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VersionBannerMode } from '../hooks/useVersionStatus';

interface VersionUpdateBannerProps {
  currentVersion: string;
  newVersion: string;
  mode?: VersionBannerMode;
  onRefresh: () => void;
  onDismiss: () => void;
}

const VersionUpdateBanner: React.FC<VersionUpdateBannerProps> = ({
  currentVersion,
  newVersion,
  mode = 'ready',
  onRefresh,
  onDismiss,
}) => {
  const { t } = useTranslation('common');
  const deploying = mode === 'deploying';

  return (
    <div className="fixed top-0 left-0 right-0 z-[10000] bg-blue-600 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {deploying
                  ? t('versionUpdateBanner.deployingTitle')
                  : t('versionUpdateBanner.title')}
                {currentVersion && newVersion && currentVersion !== newVersion && (
                  <span className="ml-2 text-blue-200">
                    (v{currentVersion} → v{newVersion})
                  </span>
                )}
              </p>
              <p className="text-xs text-blue-100 mt-1">
                {deploying
                  ? t('versionUpdateBanner.deployingDescription')
                  : t('versionUpdateBanner.description')}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 ml-4">
            {!deploying && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center px-4 py-2 bg-white text-blue-600 rounded-md hover:bg-blue-50 transition-colors font-medium text-sm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('versionUpdateBanner.refreshNow')}
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="p-2 hover:bg-blue-700 rounded-md transition-colors"
              title={t('versionUpdateBanner.dismissTooltip')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VersionUpdateBanner;
