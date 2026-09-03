import type { AdapterLockState } from '../lockfile.js';
import type { AgentTarget, MemoryProvider } from '../config.js';

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
  disposition?: 'update' | 'skip';
  reason?: string;
}

export type CheckCoverage = 'complete' | 'partial' | 'unavailable';

export interface CheckResult {
  updates: UpdateInfo[];
  coverage: CheckCoverage;
  note?: string;
  errors?: Array<{ item: string; error: string }>;
}

export interface UpdateResult {
  updated: string[];
  unchanged?: string[];
  failed: Array<{ item: string; error: string }>;
  skipped?: Array<{ item: string; reason: string }>;
  warnings?: string[];
  logs: string;
}

export interface UpdateContext {
  enabledAdapterIds: string[];
  primaryAgent?: AgentTarget | null;
  memoryProvider?: MemoryProvider | null;
}

export interface Adapter {
  id: string;
  displayName: string;
  detect(context?: UpdateContext): Promise<DetectResult>;
  check(context?: UpdateContext): Promise<CheckResult>;
  update(context?: UpdateContext): Promise<UpdateResult>;
  captureLock?(context: LockContext): Promise<AdapterLockState>;
  restoreLock?(lock: AdapterLockState, context: LockContext): Promise<UpdateResult>;
}

export interface LockContext {
  projectDir: string;
}
