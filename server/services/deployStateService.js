/**
 * Fleet deploy state (multi-pod rolling updates).
 *
 * Each replica heartbeats its baked version.json into Redis. Any pod can then
 * derive deploying (mixed versions) vs stable (all live heartbeats agree).
 * Redis down / single process: treat as unknown/stable locally — never invent
 * a cluster-wide "done" from one pod's opinion of the others.
 */

import fs from 'fs';
import os from 'os';
import redisService from './redisService.js';
import notificationService from './notificationService.js';

const HASH_KEY = 'agila:deploy:pods';
const HEARTBEAT_MS = 10_000;
const STALE_MS = 30_000;

/** @typedef {'deploying' | 'stable' | 'unknown'} DeployState */

let heartbeatTimer = null;
let localVersion = null;
let lastPublishedKey = null;
let cachedFleet = {
  deployState: 'unknown',
  fleetVersion: null,
  podCount: 0,
  versions: [],
};

export function getPodId() {
  return process.env.POD_NAME || process.env.HOSTNAME || os.hostname() || `pid-${process.pid}`;
}

export function readLocalAppVersion() {
  try {
    const versionPath = new URL('../version.json', import.meta.url);
    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    return versionData.version || process.env.APP_VERSION || '0';
  } catch {
    return process.env.APP_VERSION || '0';
  }
}

/**
 * Pure derive — unit-tested. `entries` are live (non-stale) heartbeats.
 * @param {{ version: string }[]} entries
 * @param {string} thisPodVersion
 */
export function deriveFleetState(entries, thisPodVersion) {
  const versions = [
    ...new Set(entries.map((e) => e.version).filter((v) => typeof v === 'string' && v.length > 0)),
  ];

  if (versions.length === 0) {
    return {
      deployState: 'unknown',
      fleetVersion: thisPodVersion || null,
      podCount: 0,
      versions: thisPodVersion ? [thisPodVersion] : [],
    };
  }

  if (versions.length === 1) {
    return {
      deployState: 'stable',
      fleetVersion: versions[0],
      podCount: entries.length,
      versions,
    };
  }

  return {
    deployState: 'deploying',
    fleetVersion: thisPodVersion || versions[0],
    podCount: entries.length,
    versions,
  };
}

function parseHeartbeat(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed.version !== 'string') return null;
    const ts = Number(parsed.ts);
    return { version: parsed.version, ts: Number.isFinite(ts) ? ts : 0 };
  } catch {
    return null;
  }
}

export function getCachedFleetState() {
  return { ...cachedFleet };
}

function setCachedFleet(next) {
  cachedFleet = {
    deployState: next.deployState,
    fleetVersion: next.fleetVersion,
    podCount: next.podCount,
    versions: [...(next.versions || [])],
  };
}

async function readLiveEntries(client) {
  const now = Date.now();
  const all = await client.hGetAll(HASH_KEY);
  const live = [];
  const staleFields = [];

  for (const [podId, raw] of Object.entries(all || {})) {
    const entry = parseHeartbeat(raw);
    if (!entry || now - entry.ts > STALE_MS) {
      staleFields.push(podId);
      continue;
    }
    live.push({ podId, ...entry });
  }

  if (staleFields.length > 0) {
    await client.hDel(HASH_KEY, staleFields);
  }

  return live;
}

async function writeHeartbeat(client, version) {
  const podId = getPodId();
  await client.hSet(
    HASH_KEY,
    podId,
    JSON.stringify({ version, ts: Date.now() })
  );
}

function publishKey(state) {
  return `${state.deployState}|${state.fleetVersion || ''}|${state.podCount}|${(state.versions || []).slice().sort().join(',')}`;
}

async function maybePublishTransition(state) {
  const key = publishKey(state);
  if (key === lastPublishedKey) return;
  const prev = lastPublishedKey;
  lastPublishedKey = key;

  if (!prev && state.deployState === 'stable') {
    // First observation after boot on an already-stable fleet — do not spam tabs.
    return;
  }

  try {
    await notificationService.publish(
      'deploy-state-updated',
      {
        deployState: state.deployState,
        version: state.fleetVersion,
        fleetVersion: state.fleetVersion,
        podCount: state.podCount,
        versions: state.versions,
      },
      null
    );
    console.log(
      `📦 Fleet deploy state: ${state.deployState} version=${state.fleetVersion || '?'} pods=${state.podCount}`
    );
  } catch (err) {
    console.warn('⚠️ Failed to publish deploy-state-updated:', err?.message || err);
  }
}

export async function refreshFleetState() {
  const version = localVersion || readLocalAppVersion();
  localVersion = version;

  const client = redisService.getPublisherClient();
  if (!client) {
    const local = {
      deployState: 'unknown',
      fleetVersion: version,
      podCount: 0,
      versions: version ? [version] : [],
    };
    setCachedFleet(local);
    return local;
  }

  try {
    await writeHeartbeat(client, version);
    const live = await readLiveEntries(client);
    const state = deriveFleetState(live, version);
    setCachedFleet(state);
    await maybePublishTransition(state);
    return state;
  } catch (err) {
    console.warn('⚠️ Deploy-state Redis heartbeat failed:', err?.message || err);
    const local = {
      deployState: 'unknown',
      fleetVersion: version,
      podCount: 0,
      versions: version ? [version] : [],
    };
    setCachedFleet(local);
    return local;
  }
}

export function startDeployStateHeartbeats() {
  localVersion = readLocalAppVersion();
  cachedFleet = {
    deployState: 'unknown',
    fleetVersion: localVersion,
    podCount: 0,
    versions: localVersion ? [localVersion] : [],
  };

  void refreshFleetState();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  heartbeatTimer = setInterval(() => {
    void refreshFleetState();
  }, HEARTBEAT_MS);
  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }
  console.log(`📦 Deploy-state heartbeat started (pod=${getPodId()} version=${localVersion})`);
}

export function stopDeployStateHeartbeats() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
