import { log } from '../logger.js';
import { writeProjectLock, type AdapterLockState } from '../lockfile.js';
import type { Registry } from '../adapters/registry.js';

export interface LockReport {
  lockPath: string;
  adapterIds: string[];
}

export async function runLock(registry: Registry, projectDir = process.cwd()): Promise<LockReport> {
  const adapters: Record<string, AdapterLockState> = {};
  for (const adapter of registry.list()) {
    if (!adapter.captureLock) continue;
    const detected = await adapter.detect();
    if (!detected.installed) continue;
    adapters[adapter.id] = await adapter.captureLock({ projectDir });
  }

  const lockPath = writeProjectLock({ version: 1, adapters }, projectDir);
  return { lockPath, adapterIds: Object.keys(adapters).sort() };
}

export async function printLock(registry: Registry, projectDir = process.cwd()): Promise<LockReport> {
  const report = await runLock(registry, projectDir);
  log.success(`Locked ${report.adapterIds.length} adapter(s) in ${report.lockPath}`);
  return report;
}
