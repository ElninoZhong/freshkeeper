import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { CheckCoverage, UpdateInfo } from '../adapters/types.js';
import type { AgentTarget } from '../config.js';

export interface CheckRow extends UpdateInfo {
  adapter: string;
}

export interface AdapterCheckReport {
  id: string;
  coverage: CheckCoverage;
  note?: string;
  updates: CheckRow[];
  errors: Array<{ item: string; error: string }>;
}

export interface CheckReport {
  perAdapter: AdapterCheckReport[];
  updates: CheckRow[];
  totalComplete: number;
  totalPartial: number;
  totalUnavailable: number;
  totalErrors: number;
  totalActionable: number;
  totalKnownSkips: number;
}

export async function runCheck(
  registry: Registry,
  primaryAgent?: AgentTarget | null
): Promise<CheckReport> {
  const perAdapter: AdapterCheckReport[] = [];
  const adapters = registry.list();
  const context = {
    enabledAdapterIds: adapters.map((adapter) => adapter.id),
    primaryAgent
  };
  for (const a of adapters) {
    const det = await a.detect(context);
    if (!det.installed) continue;
    try {
      const result = await a.check(context);
      perAdapter.push({
        id: a.id,
        coverage: result.coverage,
        note: result.note,
        updates: result.updates.map((update) => ({ adapter: a.id, ...update })),
        errors: result.errors ?? []
      });
    } catch (error) {
      perAdapter.push({
        id: a.id,
        coverage: 'unavailable',
        note: 'check failed before a reliable update plan could be produced',
        updates: [],
        errors: [{ item: a.id, error: error instanceof Error ? error.message : String(error) }]
      });
    }
  }
  const updates = perAdapter.flatMap((adapter) => adapter.updates);
  return {
    perAdapter,
    updates,
    totalComplete: perAdapter.filter((adapter) => adapter.coverage === 'complete').length,
    totalPartial: perAdapter.filter((adapter) => adapter.coverage === 'partial').length,
    totalUnavailable: perAdapter.filter((adapter) => adapter.coverage === 'unavailable').length,
    totalErrors: perAdapter.reduce((sum, adapter) => sum + adapter.errors.length, 0),
    totalActionable: updates.filter((update) => update.disposition !== 'skip').length,
    totalKnownSkips: updates.filter((update) => update.disposition === 'skip').length
  };
}

export async function printCheck(
  registry: Registry,
  primaryAgent?: AgentTarget | null
): Promise<void> {
  const report = await runCheck(registry, primaryAgent);
  if (report.updates.length > 0) {
    log.info(
      `${report.totalActionable} actionable update(s), ${report.totalKnownSkips} known update(s) will be skipped:`
    );
    for (const row of report.updates) {
      const action = row.disposition === 'skip' ? 'skip' : 'update';
      log.step(
        `[${row.adapter}] [${action}] ${row.item}: ${row.currentVersion} → ${row.latestVersion}${row.reason ? ` — ${row.reason}` : ''}`
      );
    }
  } else if (report.totalPartial > 0 || report.totalUnavailable > 0 || report.totalErrors > 0) {
    log.warn('No updates confirmed among fully checkable components; this is not an all-current result.');
  } else {
    log.success('No pending updates detected across all installed, enabled components.');
  }

  for (const adapter of report.perAdapter) {
    if (adapter.coverage === 'partial') {
      log.warn(`${adapter.id}: partially checkable${adapter.note ? ` — ${adapter.note}` : ''}`);
    }
    if (adapter.coverage === 'unavailable') {
      log.warn(`${adapter.id}: preflight unavailable${adapter.note ? ` — ${adapter.note}` : ''}`);
    }
    for (const error of adapter.errors) log.error(`${adapter.id}: ${error.item} — ${error.error}`);
  }
  log.info(
    `Coverage: ${report.totalComplete} complete, ${report.totalPartial} partial, ${report.totalUnavailable} unavailable, ${report.totalErrors} error(s).`
  );
  if (report.totalErrors > 0) process.exitCode = 1;
}
