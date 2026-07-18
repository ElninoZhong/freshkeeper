import { Command } from 'commander';
import { createRequire } from 'node:module';
import { buildRegistry } from './adapters/catalog.js';
import { loadConfig } from './config.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
import { printList } from './commands/list.js';
import { printCheck } from './commands/check.js';
import { printUpdate } from './commands/update.js';
import { runSchedule } from './commands/schedule.js';
import { runInit } from './commands/init.js';

function configuredRegistry() {
  return buildRegistry(loadConfig().enabledAdapters);
}

export async function run(): Promise<void> {
  const program = new Command();
  program
    .name('freshkeeper')
    .description('Unified update keeper for AI coding agents')
    .version(pkg.version);

  program
    .command('list')
    .description('Show which supported agents are installed')
    .action(async () => {
      const r = configuredRegistry();
      await printList(r);
    });

  program
    .command('check')
    .description('Show pending updates across installed agents')
    .action(async () => {
      const r = configuredRegistry();
      await printCheck(r);
    });

  program
    .command('update')
    .description('Update all installed agents (CLI + plugins + skills)')
    .action(async () => {
      const r = configuredRegistry();
      await printUpdate(r);
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
    .action(async () => {
      const r = configuredRegistry();
      await runInit(r);
    });

  await program.parseAsync(process.argv);
}
