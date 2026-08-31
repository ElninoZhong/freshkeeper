import type { AdapterLockState } from '../lockfile.js';

export interface DetectResult {
  installed: boolean;
  version?: string;
  installMethod?: string;
  note?: string;
}

export interface UpdateInfo {
  item: string;
  currentVersion: string;
  latestVersion: string;
  source?: string;
  changelogUrl?: string;
}

export interface UpdateResult {
  updated: string[];
  failed: Array<{ item: string; error: string }>;
  skipped?: Array<{ item: string; reason: string }>;
  warnings?: string[];
  logs: string;
}

export interface UpdateContext {
  enabledAdapterIds: string[];
}

export interface Adapter {
  id: string;
  displayName: string;
  detect(): Promise<DetectResult>;
  check(): Promise<UpdateInfo[]>;
  update(context?: UpdateContext): Promise<UpdateResult>;
  captureLock?(context: LockContext): Promise<AdapterLockState>;
  restoreLock?(lock: AdapterLockState, context: LockContext): Promise<UpdateResult>;
}

export interface LockContext {
  projectDir: string;
}
