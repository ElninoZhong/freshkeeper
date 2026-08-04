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
  logs: string;
}

export interface Adapter {
  id: string;
  displayName: string;
  detect(): Promise<DetectResult>;
  check(): Promise<UpdateInfo[]>;
  update(): Promise<UpdateResult>;
  captureLock?(context: LockContext): Promise<AdapterLockState>;
  restoreLock?(lock: AdapterLockState, context: LockContext): Promise<UpdateResult>;
}

export interface LockContext {
  projectDir: string;
}
