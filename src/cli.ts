import { Command } from 'commander';
import { createRequire } from 'node:module';
import { buildRegistry } from './adapters/catalog.js';
import { loadConfig, type AgentTarget, type MemoryProvider } from './config.js';
import { parseComponent, selectAdapterIds } from './component-selection.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
import { printList } from './commands/list.js';
import { printCheck } from './commands/check.js';
import { printUpdate } from './commands/update.js';
import { runSchedule } from './commands/schedule.js';
import { runInit } from './commands/init.js';
import { printLock } from './commands/lock.js';
import { printRestore } from './commands/restore.js';

function configuredRuntime(componentValue?: string) {
  const config = loadConfig();
  const component = parseComponent(componentValue);
  return {
    registry: buildRegistry(selectAdapterIds(config.enabledAdapters, component, config.primaryAgent)),
    primaryAgent: config.primaryAgent,
    memoryProvider: config.memoryProvider
  };
}

export async function run(): Promise<void> {
  const program = new Command();
  program
    .name('freshkeeper')
    .description('Unified update keeper for AI coding agents')
    .version(pkg.version);

  program
    .command('list [component]')
    .description('Show installed state for all, agent, plugins, skills, or mcp')
    .action(async (component?: string) => {
      const { registry: r, primaryAgent } = configuredRuntime(component);
      await printList(r, primaryAgent);
    });

  program
    .command('check [component]')
    .description('Show pending updates for all, agent, plugins, skills, or mcp')
    .action(async (component?: string) => {
      const { registry: r, primaryAgent } = configuredRuntime(component);
      await printCheck(r, primaryAgent);
    });

  program
    .command('update [component]')
    .description('Update all, agent, plugins, skills, or safely managed MCP components')
    .option('--respect-lock', 'Restore and verify versions from the nearest freshkeeper.lock.json')
    .action(async (component: string | undefined, options: { respectLock?: boolean }) => {
      const { registry: r, primaryAgent, memoryProvider } = configuredRuntime(component);
      if (options.respectLock) await printRestore(r);
      else await printUpdate(r, { primaryAgent, memoryProvider });
    });

  program
    .command('lock')
    .description('Snapshot exact project tool versions into freshkeeper.lock.json')
    .action(async () => {
      const { registry: r } = configuredRuntime();
      await printLock(r);
    });

  program
    .command('restore')
    .description('Restore and verify versions from the nearest freshkeeper.lock.json')
    .action(async () => {
      const { registry: r } = configuredRuntime();
      await printRestore(r);
    });

  program
    .command('schedule <cron>')
    .description('Set update schedule cron expression, or "off" to remove it')
    .action(async (cron) => {
      await runSchedule(cron);
    });

  program
    .command('init')
    .description('Interactive setup: detect agents, run first update, install schedule')
    .option('--agent <agent>', 'Manage one primary agent: codex, claude, openclaw, or hermes')
    .option('--memory-provider <provider>', 'Choose codex/claude OAuth plan usage, or a separately credentialed gemini/openrouter API')
    .action(async (options: { agent?: string; memoryProvider?: string }) => {
      const allowed = new Set<AgentTarget>(['codex', 'claude', 'openclaw', 'hermes']);
      if (options.agent && !allowed.has(options.agent as AgentTarget)) {
        throw new Error(`Unknown agent: ${options.agent}. Choose codex, claude, openclaw, or hermes.`);
      }
      const allowedProviders = new Set<MemoryProvider>(['codex', 'claude', 'gemini', 'openrouter']);
      if (options.memoryProvider && !allowedProviders.has(options.memoryProvider as MemoryProvider)) {
        throw new Error(`Unknown memory provider: ${options.memoryProvider}. Choose codex, claude, gemini, or openrouter.`);
      }
      await runInit({
        primaryAgent: options.agent as AgentTarget | undefined,
        memoryProvider: options.memoryProvider as MemoryProvider | undefined
      });
    });

  await program.parseAsync(process.argv);
}
