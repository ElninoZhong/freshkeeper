import { log } from '../logger.js';
import { loadProjectLock } from '../lockfile.js';
import type { Registry } from '../adapters/registry.js';
import type { UpdateResult } from '../adapters/types.js';

export interface RestoreReport {
  lockPath: string;
  perAdapter: Array<{ id: string; result: UpdateResult }>;
  skipped: string[];
  totalUpdated: number;
  totalFailed: number;
}

export async function runRestore(registry: Registry, startDir = process.cwd()): Promise<RestoreReport> {
  const loaded = loadProjectLock(startDir);
  const perAdapter: RestoreReport['perAdapter'] = [];
  const skipped: string[] = [];

  for (const [id, state] of Object.entries(loaded.lock.adapters)) {
    const adapter = registry.get(id);
    if (!adapter) {
      skipped.push(id);
      continue;
    }
    if (!adapter.restoreLock) {
      perAdapter.push({
        id,
        result: { updated: [], failed: [{ item: id, error: 'adapter does not support project locks' }], logs: '' }
      });
      continue;
    }
    perAdapter.push({ id, result: await adapter.restoreLock(state, { projectDir: loaded.projectDir }) });
  }

  return {
    lockPath: loaded.lockPath,
    perAdapter,
    skipped,
    totalUpdated: perAdapter.reduce((sum, item) => sum + item.result.updated.length, 0),
    totalFailed: perAdapter.reduce((sum, item) => sum + item.result.failed.length, 0)
  };
}

export async function printRestore(registry: Registry, startDir = process.cwd()): Promise<RestoreReport> {
  const report = await runRestore(registry, startDir);
  for (const { id, result } of report.perAdapter) {
    if (result.updated.length) log.success(`${id}: restored ${result.updated.join(', ')}`);
    else if (result.failed.length === 0) log.info(`${id}: already matches lock`);
    for (const failure of result.failed) log.error(`${id}: failed ${failure.item} — ${failure.error}`);
  }
  for (const id of report.skipped) log.info(`${id}: skipped because the adapter is disabled`);
  log.info(`Restore complete. ${report.totalUpdated} restored, ${report.totalFailed} failed.`);
  if (report.totalFailed > 0) process.exitCode = 1;
  return report;
}
