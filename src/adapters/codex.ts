import { safeExec } from '../util/exec.js';
import { freshkeeperHome } from '../util/paths.js';
import type { Adapter, CheckResult } from './types.js';

const NPM_REGISTRY = 'https://registry.npmjs.org/';

async function installedVersion(): Promise<string | undefined> {
  const result = await safeExec('codex', ['--version']);
  return result.ok ? result.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] : undefined;
}

async function latestVersion(): Promise<string | undefined> {
  const result = await safeExec('npm', [
    'view',
    '@openai/codex',
    'version',
    '--json',
    '--registry',
    NPM_REGISTRY
  ], {
    env: { ...process.env, npm_config_cache: `${freshkeeperHome()}/npm-cache` }
  });
  if (!result.ok) return undefined;
  return result.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
}

async function codexUpdatePlan(): Promise<CheckResult> {
  const [currentVersion, availableVersion] = await Promise.all([
    installedVersion(),
    latestVersion()
  ]);
  if (!currentVersion) {
    return {
      updates: [],
      coverage: 'unavailable',
      note: 'installed Codex version could not be resolved'
    };
  }
  if (!availableVersion) {
    return {
      updates: [],
      coverage: 'unavailable',
      note: 'latest npm version could not be resolved'
    };
  }
  return {
    updates: currentVersion === availableVersion ? [] : [{
      item: 'codex',
      currentVersion,
      latestVersion: availableVersion,
      source: 'npm:@openai/codex'
    }],
    coverage: 'complete'
  };
}

export const codexAdapter: Adapter = {
  id: 'codex',
  displayName: 'OpenAI Codex CLI',

  async detect() {
    const version = await installedVersion();
    return version ? { installed: true, version, installMethod: 'codex-self-update' } : { installed: false };
  },

  async check() {
    return codexUpdatePlan();
  },

  async update() {
    const plan = await codexUpdatePlan();
    if (plan.coverage !== 'complete') {
      return {
        updated: [],
        failed: [{ item: 'codex', error: plan.note ?? 'update plan could not be resolved' }],
        logs: ''
      };
    }
    if (plan.updates.length === 0) {
      const version = await installedVersion();
      return {
        updated: [],
        unchanged: [`codex@${version ?? 'current'}`],
        failed: [],
        logs: 'Codex already matches the checked npm version.'
      };
    }
    const target = plan.updates[0]!.latestVersion;

    const mutation = await safeExec('codex', ['update'], { timeoutMs: 300_000 });
    if (!mutation.ok) {
      return {
        updated: [],
        failed: [{ item: 'codex', error: mutation.stderr || mutation.error || 'Codex self-update failed' }],
        logs: mutation.stdout
      };
    }

    const version = await installedVersion();
    return {
      updated: version === target ? [`codex@${version}`] : [],
      failed: version === target
        ? []
        : [{ item: 'codex', error: `expected ${target}, detected ${version ?? 'missing'}` }],
      logs: mutation.stdout
    };
  }
};
