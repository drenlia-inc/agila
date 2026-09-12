import { BUILD_VERSION } from './buildVersion';

/**
 * Version / fleet-deploy detection.
 *
 * Reload and banner logic use the pod's version.json (X-App-Version /
 * X-Deploy-Fleet-Version) plus Redis-derived X-Deploy-State — not DB APP_VERSION.
 *
 * During a rolling update, pods disagree → deploying → never reload.
 * When every live heartbeat agrees and this tab is behind → reload (or banner).
 */

type VersionChangeCallback = (oldVersion: string, newVersion: string) => void;
type DeployingCallback = (deploying: boolean, fleetVersion: string | null) => void;

export type DeployState = 'deploying' | 'stable' | 'unknown';

export type FleetSignal = {
  version?: string | null;
  deployState?: string | null;
  podCount?: number | null;
  fleetVersion?: string | null;
};

const DISMISSED_KEY = 'dismissedVersion';

function readDismissedVersion(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISSED_KEY) : null;
  } catch {
    return null;
  }
}

function normalizeDeployState(raw?: string | null): DeployState {
  if (raw === 'deploying' || raw === 'stable') return raw;
  return 'unknown';
}

export function shouldAutoReloadForFleet(opts: {
  deployState: DeployState;
  pageVersion: string | null;
  fleetVersion: string | null;
  sawDeploying: boolean;
  podCount: number;
}): boolean {
  if (opts.deployState !== 'stable') return false;
  if (!opts.fleetVersion || !opts.pageVersion) return false;
  if (opts.fleetVersion === opts.pageVersion) return false;
  if (readDismissedVersion() === opts.fleetVersion) return false;
  return opts.sawDeploying || opts.podCount >= 2;
}

class VersionDetectionService {
  private initialVersion: string | null = null;
  private listeners: VersionChangeCallback[] = [];
  private deployingListeners: DeployingCallback[] = [];
  private isInitialized = false;
  private lastNotifiedVersion: string | null = null;
  private sawDeploying = false;
  private lastPodCount = 0;
  private lastDeployState: DeployState = 'unknown';

  setInitialVersion(version: string) {
    const wasInitialized = this.isInitialized;
    this.initialVersion = version;
    this.isInitialized = true;
    this.lastNotifiedVersion = null;
    if (!wasInitialized) {
      console.log(`📦 Initial app version: ${version}`);
    } else {
      console.log(`📦 Updated app version: ${version}`);
    }
  }

  /**
   * Apply fleet + this-pod version from headers, /api/version, or WebSocket.
   */
  applyFleetSignal(signal: FleetSignal): void {
    const deployState = normalizeDeployState(signal.deployState);
    const fleetVersion = signal.fleetVersion || signal.version || null;
    const thisPodVersion = signal.version || fleetVersion;
    const podCount = typeof signal.podCount === 'number' && Number.isFinite(signal.podCount)
      ? signal.podCount
      : 0;

    this.lastDeployState = deployState;
    this.lastPodCount = podCount;

    if (!this.isInitialized || !this.initialVersion) {
      if (thisPodVersion) {
        this.setInitialVersion(thisPodVersion);
      }
      if (deployState === 'deploying') {
        this.sawDeploying = true;
        this.notifyDeploying(true, fleetVersion);
      }
      return;
    }

    if (deployState === 'deploying') {
      this.sawDeploying = true;
      this.notifyDeploying(true, fleetVersion);
      return;
    }

    this.notifyDeploying(false, fleetVersion);

    if (deployState !== 'stable' || !fleetVersion) {
      return;
    }

    this.maybeNotifyStableUpgrade(fleetVersion);
  }

  /**
   * @deprecated Prefer applyFleetSignal. Kept so older call sites still compile.
   * Without deployState this never triggers a reload (avoids mid-rollout flips).
   */
  checkVersion(newVersion: string, isFromWebSocket: boolean = false): boolean {
    if (!newVersion) return false;
    if (!this.isInitialized || !this.initialVersion) {
      if (!isFromWebSocket) {
        this.setInitialVersion(newVersion);
      }
      return false;
    }
    return false;
  }

  onVersionChange(callback: VersionChangeCallback) {
    this.listeners.push(callback);
  }

  offVersionChange(callback: VersionChangeCallback) {
    this.listeners = this.listeners.filter((cb) => cb !== callback);
  }

  onDeployingChange(callback: DeployingCallback) {
    this.deployingListeners.push(callback);
  }

  offDeployingChange(callback: DeployingCallback) {
    this.deployingListeners = this.deployingListeners.filter((cb) => cb !== callback);
  }

  private notifyDeploying(deploying: boolean, fleetVersion: string | null) {
    this.deployingListeners.forEach((callback) => {
      try {
        callback(deploying, fleetVersion);
      } catch (error) {
        console.error('Error in deploy-state callback:', error);
      }
    });
  }

  private maybeNotifyStableUpgrade(fleetVersion: string) {
    const dismissedVersion = readDismissedVersion();
    if (dismissedVersion === fleetVersion) {
      if (this.initialVersion !== fleetVersion) {
        this.initialVersion = fleetVersion;
      }
      return;
    }

    if (!this.initialVersion || fleetVersion === this.initialVersion) {
      return;
    }

    if (this.lastNotifiedVersion === fleetVersion) {
      return;
    }

    console.log(`🔄 Fleet stable on newer build: ${this.initialVersion} → ${fleetVersion}`);
    this.notifyListeners(this.initialVersion, fleetVersion);
    this.lastNotifiedVersion = fleetVersion;
  }

  shouldAutoReload(fleetVersion: string | null): boolean {
    return shouldAutoReloadForFleet({
      deployState: this.lastDeployState,
      pageVersion: this.initialVersion,
      fleetVersion,
      sawDeploying: this.sawDeploying,
      podCount: this.lastPodCount,
    });
  }

  private notifyListeners(oldVersion: string, newVersion: string) {
    this.listeners.forEach((callback) => {
      try {
        callback(oldVersion, newVersion);
      } catch (error) {
        console.error('Error in version change callback:', error);
      }
    });
  }

  getInitialVersion(): string | null {
    return this.initialVersion;
  }

  getSawDeploying(): boolean {
    return this.sawDeploying;
  }

  reset() {
    this.initialVersion = null;
    this.isInitialized = false;
    this.lastNotifiedVersion = null;
    this.sawDeploying = false;
    this.lastPodCount = 0;
    this.lastDeployState = 'unknown';
    this.listeners = [];
    this.deployingListeners = [];
  }
}

export const versionDetection = new VersionDetectionService();

if (BUILD_VERSION && BUILD_VERSION !== 'dev') {
  versionDetection.setInitialVersion(BUILD_VERSION);
}
