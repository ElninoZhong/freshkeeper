import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';

export interface ListRow {
  id: string;
  installed: boolean;
  version?: string;
}

export async function runList(registry: Registry): Promise<ListRow[]> {
  const rows: ListRow[] = [];
  for (const a of registry.list()) {
    const det = await a.detect();
    rows.push({ id: a.id, installed: det.installed, version: det.version });
  }
  return rows;
}

export async function printList(registry: Registry): Promise<void> {
  const rows = await runList(registry);
  for (const r of rows) {
    if (r.installed) log.success(`${r.id.padEnd(20)} ${r.version ?? ''}`);
    else log.warn(`${r.id.padEnd(20)} (not installed)`);
  }
}
