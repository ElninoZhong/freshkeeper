import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { UpdateInfo } from '../adapters/types.js';

export interface CheckRow extends UpdateInfo {
  adapter: string;
}

export async function runCheck(registry: Registry): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const a of registry.list()) {
    const det = await a.detect();
    if (!det.installed) continue;
    const updates = await a.check();
    for (const u of updates) rows.push({ adapter: a.id, ...u });
  }
  return rows;
}

export async function printCheck(registry: Registry): Promise<void> {
  const rows = await runCheck(registry);
  if (rows.length === 0) {
    log.success('No pending updates detected via dry-run (some adapters only expose changes after `update`).');
    return;
  }
  log.info(`${rows.length} update(s) available:`);
  for (const r of rows) {
    log.step(`[${r.adapter}] ${r.item}: ${r.currentVersion} → ${r.latestVersion}`);
  }
}
