/**
 * Hook for managing version and instance status state
 */

import { useState, useEffect, useRef } from 'react';
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

export type VersionBannerMode = 'hidden' | 'deploying' | 'ready';

export interface UseVersionStatusReturn {
  instanceStatus: InstanceStatus;
  setInstanceStatus: (status: InstanceStatus | ((prev: InstanceStatus) => InstanceStatus)) => void;

  versionBannerMode: VersionBannerMode;
  showVersionBanner: boolean;
  setShowVersionBanner: (show: boolean) => void;
  versionInfo: VersionInfo;
  setVersionInfo: (info: VersionInfo) => void;

  handleRefreshVersion: () => void;
  handleDismissVersionBanner: () => void;

  InstanceStatusBanner: () => JSX.Element | null;
}

export const useVersionStatus = (): UseVersionStatusReturn => {
  const [instanceStatus, setInstanceStatus] = useState<InstanceStatus>({
    status: 'active',
    message: '',
    isDismissed: false,
  });

  const [versionBannerMode, setVersionBannerMode] = useState<VersionBannerMode>('hidden');
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    currentVersion: '',
    newVersion: '',
  });
  const autoReloadStarted = useRef(false);

  const navigateWithCacheBust = (targetVersion?: string) => {
    if (targetVersion) {
      localStorage.setItem('dismissedVersion', targetVersion);
    }
    sessionStorage.setItem('pendingVersionRefresh', 'true');
    const u = new URL(window.location.href);
    u.searchParams.set('_v', String(Date.now()));
    window.location.href = u.toString();
  };

  const handleRefreshVersion = () => {
    const targetVersion = versionInfo.newVersion;
    if (targetVersion) {
      localStorage.setItem('dismissedVersion', targetVersion);
    }
    sessionStorage.setItem('pendingVersionRefresh', 'true');
    setVersionBannerMode('hidden');

    void (async () => {
      const maxAttempts = 12;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const res = await fetch('/api/version', { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as {
              version?: string;
              fleetVersion?: string;
              deployState?: string;
            } | null;
            const served =
              data?.fleetVersion ||
              data?.version ||
              res.headers.get('x-deploy-fleet-version') ||
              res.headers.get('x-app-version') ||
              '';
            const deployState =
              data?.deployState || res.headers.get('x-deploy-state') || '';
            const fleetReady = deployState !== 'deploying';
            if (fleetReady && (!targetVersion || served === targetVersion)) {
              navigateWithCacheBust(targetVersion);
              return;
            }
            console.log(
              `⏳ Waiting for fleet: deployState=${deployState || 'unknown'} version=${served || 'unknown'} want ${targetVersion} (try ${attempt + 1}/${maxAttempts})`
            );
          }
        } catch {
          /* network / pod gone — retry */
        }
        await new Promise((r) => setTimeout(r, 400 + attempt * 200));
      }
      navigateWithCacheBust(targetVersion);
    })();
  };

  useEffect(() => {
    const handleVersionChange = (oldVersion: string, newVersion: string) => {
      console.log(`🔔 Fleet stable on newer build: ${oldVersion} → ${newVersion}`);

      const dismissedVersion = localStorage.getItem('dismissedVersion');
      if (dismissedVersion === newVersion) {
        return;
      }

      setVersionInfo({
        currentVersion: oldVersion === 'unknown' ? newVersion : oldVersion,
        newVersion,
      });

      if (versionDetection.shouldAutoReload(newVersion) && !autoReloadStarted.current) {
        autoReloadStarted.current = true;
        setVersionBannerMode('ready');
        // Defer so versionInfo is set for handleRefreshVersion's closure —
        // navigate uses newVersion directly below.
        localStorage.setItem('dismissedVersion', newVersion);
        sessionStorage.setItem('pendingVersionRefresh', 'true');
        void (async () => {
          const maxAttempts = 12;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              const res = await fetch('/api/version', { cache: 'no-store' });
              if (res.ok) {
                const data = (await res.json().catch(() => null)) as {
                  version?: string;
                  fleetVersion?: string;
                  deployState?: string;
                } | null;
                const served = data?.fleetVersion || data?.version || '';
                const deployState = data?.deployState || '';
                if (deployState !== 'deploying' && served === newVersion) {
                  const u = new URL(window.location.href);
                  u.searchParams.set('_v', String(Date.now()));
                  window.location.href = u.toString();
                  return;
                }
              }
            } catch {
              /* retry */
            }
            await new Promise((r) => setTimeout(r, 400 + attempt * 200));
          }
          const u = new URL(window.location.href);
          u.searchParams.set('_v', String(Date.now()));
          window.location.href = u.toString();
        })();
        return;
      }

      setVersionBannerMode('ready');
    };

    const handleDeploying = (deploying: boolean, fleetVersion: string | null) => {
      if (deploying) {
        setVersionInfo((prev) => ({
          currentVersion: versionDetection.getInitialVersion() || prev.currentVersion,
          newVersion: fleetVersion || prev.newVersion,
        }));
        setVersionBannerMode('deploying');
        return;
      }
      setVersionBannerMode((mode) => (mode === 'deploying' ? 'hidden' : mode));
    };

    versionDetection.onVersionChange(handleVersionChange);
    versionDetection.onDeployingChange(handleDeploying);
    return () => {
      versionDetection.offVersionChange(handleVersionChange);
      versionDetection.offDeployingChange(handleDeploying);
    };
  }, []);

  const handleDismissVersionBanner = () => {
    setVersionBannerMode('hidden');
    // Only remember a skip for the *ready* (reload) banner. Dismissing
    // "update in progress" must not block the post-rollout refresh.
    if (versionBannerMode === 'ready' && versionInfo.newVersion) {
      localStorage.setItem('dismissedVersion', versionInfo.newVersion);
    }
  };

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
    versionBannerMode,
    showVersionBanner: versionBannerMode !== 'hidden',
    setShowVersionBanner: (show: boolean) => setVersionBannerMode(show ? 'ready' : 'hidden'),
    versionInfo,
    setVersionInfo,
    handleRefreshVersion,
    handleDismissVersionBanner,
    InstanceStatusBanner,
  };
};
