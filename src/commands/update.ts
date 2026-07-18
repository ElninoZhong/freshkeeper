import ora from 'ora';
import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { UpdateResult } from '../adapters/types.js';

export interface UpdateReport {
  perAdapter: Array<{ id: string; result: UpdateResult }>;
  totalUpdated: number;
  totalFailed: number;
}

export async function runUpdate(registry: Registry): Promise<UpdateReport> {
  const perAdapter: UpdateReport['perAdapter'] = [];
  for (const a of registry.list()) {
    const det = await a.detect();
    if (!det.installed) continue;
    const result = await a.update();
    perAdapter.push({ id: a.id, result });
  }
  return {
    perAdapter,
    totalUpdated: perAdapter.reduce((s, x) => s + x.result.updated.length, 0),
    totalFailed: perAdapter.reduce((s, x) => s + x.result.failed.length, 0)
  };
}

export async function printUpdate(registry: Registry): Promise<UpdateReport> {
  const spinner = ora('Updating all installed agents...').start();
  const report = await runUpdate(registry);
  spinner.stop();
  for (const { id, result } of report.perAdapter) {
    if (result.updated.length) log.success(`${id}: updated ${result.updated.join(', ')}`);
    else log.info(`${id}: no changes`);
    for (const f of result.failed) log.error(`${id}: failed ${f.item} — ${f.error}`);
  }
  log.info(`Done. ${report.totalUpdated} updated, ${report.totalFailed} failed.`);
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
