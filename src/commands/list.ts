import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { AgentTarget } from '../config.js';

export interface ListRow {
  id: string;
  installed: boolean;
  version?: string;
  note?: string;
}

export async function runList(
  registry: Registry,
  primaryAgent?: AgentTarget | null
): Promise<ListRow[]> {
  const rows: ListRow[] = [];
  const adapters = registry.list();
  const context = {
    enabledAdapterIds: adapters.map((adapter) => adapter.id),
    primaryAgent
  };
  for (const a of adapters) {
    const det = await a.detect(context);
    rows.push({ id: a.id, installed: det.installed, version: det.version, note: det.note });
  }
  return rows;
}

export async function printList(
  registry: Registry,
  primaryAgent?: AgentTarget | null
): Promise<void> {
  const rows = await runList(registry, primaryAgent);
  for (const r of rows) {
    if (r.installed) log.success(`${r.id.padEnd(20)} ${r.version ?? r.note ?? ''}`);
    else log.warn(`${r.id.padEnd(20)} (not installed)`);
  }
}
