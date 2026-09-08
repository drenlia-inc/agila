/**
 * Hook for managing version and instance status state
 */

import { useState, useEffect } from 'react';
import { versionDetection } from '../utils/versionDetection';
import InstanceStatusBannerView from '../components/layout/InstanceStatusBanner';

export interface InstanceStatus {
  status: string;
  message: string;
  isDismissed: boolean;
}

export interface VersionInfo {
  currentVersion: string;
  newVersion: string;
}

export interface UseVersionStatusReturn {
  // Instance Status
  instanceStatus: InstanceStatus;
  setInstanceStatus: (status: InstanceStatus | ((prev: InstanceStatus) => InstanceStatus)) => void;
  
  // Version Banner
  showVersionBanner: boolean;
  setShowVersionBanner: (show: boolean) => void;
  versionInfo: VersionInfo;
  setVersionInfo: (info: VersionInfo) => void;
  
  // Handlers
  handleRefreshVersion: () => void;
  handleDismissVersionBanner: () => void;
  
  // Component
  InstanceStatusBanner: () => JSX.Element | null;
}

export const useVersionStatus = (): UseVersionStatusReturn => {
  // Instance Status Banner State
  const [instanceStatus, setInstanceStatus] = useState<InstanceStatus>({
    status: 'active',
    message: '',
    isDismissed: false
  });

  // Version Update Banner State
  const [showVersionBanner, setShowVersionBanner] = useState<boolean>(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    currentVersion: '',
    newVersion: ''
  });

  // Version detection setup
  useEffect(() => {
    const handleVersionChange = (oldVersion: string, newVersion: string) => {
      console.log(`🔔 Version change detected: ${oldVersion} → ${newVersion}`);

      const dismissedVersion = localStorage.getItem('dismissedVersion');

      // Only clear dismissal when a *different* version is a genuine upgrade path.
      // Do NOT clear when an older pod answers mid-rollout (that caused 2nd/3rd banners).
      if (dismissedVersion === newVersion) {
        console.log(`🔕 Version ${newVersion} was already dismissed, not showing banner`);
        setVersionInfo({
          currentVersion: oldVersion === 'unknown' ? newVersion : oldVersion,
          newVersion,
        });
        return;
      }

      let displayCurrentVersion = oldVersion;
      if (oldVersion === 'unknown') {
        const initialVersion = versionDetection.getInitialVersion();
        if (initialVersion && initialVersion !== newVersion) {
          displayCurrentVersion = initialVersion;
          console.log(`📝 Using initial version from API headers: ${initialVersion}`);
        } else {
          displayCurrentVersion = newVersion;
        }
      }

      setVersionInfo({
        currentVersion: displayCurrentVersion,
        newVersion,
      });
      setShowVersionBanner(true);
    };

    versionDetection.onVersionChange(handleVersionChange);
    return () => {
      versionDetection.offVersionChange(handleVersionChange);
    };
  }, []);

  // Handlers for version banner
  const handleRefreshVersion = () => {
    const targetVersion = versionInfo.newVersion;
    if (targetVersion) {
      localStorage.setItem('dismissedVersion', targetVersion);
    }
    sessionStorage.setItem('pendingVersionRefresh', 'true');
    setShowVersionBanner(false);

    const navigateWithCacheBust = () => {
      const u = new URL(window.location.href);
      u.searchParams.set('_v', String(Date.now()));
      window.location.href = u.toString();
    };

    // Wait until we hit a pod that already serves the target build (avoids reload onto old replica).
    void (async () => {
      const maxAttempts = 12;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const res = await fetch('/api/version', { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { version?: string } | null;
            const served = data?.version || res.headers.get('x-app-version') || '';
            if (!targetVersion || served === targetVersion) {
              navigateWithCacheBust();
              return;
            }
            console.log(
              `⏳ Waiting for rollout: /api/version is ${served || 'unknown'}, want ${targetVersion} (try ${attempt + 1}/${maxAttempts})`
            );
          }
        } catch {
          /* network / pod gone — retry */
        }
        await new Promise((r) => setTimeout(r, 400 + attempt * 200));
      }
      navigateWithCacheBust();
    })();
  };

  const handleDismissVersionBanner = () => {
    setShowVersionBanner(false);
    // When dismissing, we want to:
    // 1. Remember this specific version was dismissed (localStorage)
    // 2. NOT update initialVersion because we want to detect NEWER versions later
    //    (e.g., if user dismisses v2, we still want to detect v3, v4, etc.)
    // The lastNotifiedVersion tracking prevents duplicate notifications for the same version
    if (versionInfo.newVersion) {
      localStorage.setItem('dismissedVersion', versionInfo.newVersion);
    }
  };
  
  // Instance Status Banner Component
  const InstanceStatusBanner = () => (
    <InstanceStatusBannerView
      status={instanceStatus.status}
      message={instanceStatus.message}
      isDismissed={instanceStatus.isDismissed}
      onDismiss={() => setInstanceStatus((prev) => ({ ...prev, isDismissed: true }))}
      layout="header"
    />
  );

  return {
    instanceStatus,
    setInstanceStatus,
    showVersionBanner,
    setShowVersionBanner,
    versionInfo,
    setVersionInfo,
    handleRefreshVersion,
    handleDismissVersionBanner,
    InstanceStatusBanner,
  };
};

