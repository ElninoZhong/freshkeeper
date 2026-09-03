import ora from 'ora';
import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { UpdateResult } from '../adapters/types.js';
import type { AgentTarget, MemoryProvider } from '../config.js';

export interface UpdateReport {
  perAdapter: Array<{ id: string; result: UpdateResult }>;
  totalUpdated: number;
  totalUnchanged: number;
  totalFailed: number;
  totalSkipped: number;
}

export interface UpdateSelection {
  primaryAgent?: AgentTarget | null;
  memoryProvider?: MemoryProvider | null;
}

export async function runUpdate(
  registry: Registry,
  selection: UpdateSelection = {}
): Promise<UpdateReport> {
  const perAdapter: UpdateReport['perAdapter'] = [];
  const adapters = registry.list();
  const context = {
    enabledAdapterIds: adapters.map((adapter) => adapter.id),
    primaryAgent: selection.primaryAgent,
    memoryProvider: selection.memoryProvider
  };
  for (const a of adapters) {
    const det = await a.detect(context);
    if (!det.installed) continue;
    const result = await a.update(context);
    perAdapter.push({ id: a.id, result });
  }
  return {
    perAdapter,
    totalUpdated: perAdapter.reduce((s, x) => s + x.result.updated.length, 0),
    totalUnchanged: perAdapter.reduce((s, x) => s + (x.result.unchanged?.length ?? 0), 0),
    totalFailed: perAdapter.reduce((s, x) => s + x.result.failed.length, 0),
    totalSkipped: perAdapter.reduce((s, x) => s + (x.result.skipped?.length ?? 0), 0)
  };
}

export async function printUpdate(
  registry: Registry,
  selection: UpdateSelection = {}
): Promise<UpdateReport> {
  const spinner = ora('Updating installed agents and managed MCP components...').start();
  const report = await runUpdate(registry, selection);
  spinner.stop();
  for (const { id, result } of report.perAdapter) {
    if (result.updated.length) log.success(`${id}: updated ${result.updated.join(', ')}`);
    if (result.unchanged?.length) log.info(`${id}: already current ${result.unchanged.join(', ')}`);
    if (!result.updated.length && !result.unchanged?.length) log.info(`${id}: no changes`);
    for (const f of result.failed) log.error(`${id}: failed ${f.item} — ${f.error}`);
    for (const skipped of result.skipped ?? []) log.warn(`${id}: skipped ${skipped.item} — ${skipped.reason}`);
    for (const warning of result.warnings ?? []) log.warn(`${id}: ${warning}`);
  }
  log.info(
    `Done. ${report.totalUpdated} updated, ${report.totalUnchanged} already current, ${report.totalSkipped} skipped, ${report.totalFailed} failed.`
  );
  const { aggregateChangelog, ADAPTER_REPOS } = await import('../changelog/aggregate.js');
  const entries = await aggregateChangelog(
    report.perAdapter
      .filter(x => x.result.updated.length > 0)
      .map(x => ({ id: x.id, repo: ADAPTER_REPOS[x.id] }))
  );
  if (entries.length) {
    console.log('\n--- Changelogs ---');
    for (const e of entries) {
      console.log(`\n[${e.adapter}] ${e.tag}`);
      console.log(e.body.slice(0, 500));
      console.log(`→ ${e.url}`);
    }
  }
  if (report.totalFailed > 0) process.exitCode = 1;
  return report;
}
