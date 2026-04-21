import { Command } from 'commander';
import { Registry } from './adapters/registry.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { claudePluginsAdapter } from './adapters/claude-plugins.js';
import { skillsCliAdapter } from './adapters/skills-cli.js';
import { codexAdapter } from './adapters/codex.js';
import { openClawAdapter } from './adapters/openclaw.js';
import { hermesAdapter } from './adapters/hermes.js';
import { printList } from './commands/list.js';
import { printCheck } from './commands/check.js';
import { printUpdate } from './commands/update.js';
import { runSchedule } from './commands/schedule.js';
import { runInit } from './commands/init.js';

function buildRegistry(): Registry {
  const r = new Registry();
  r.register(claudeCodeAdapter);
  r.register(claudePluginsAdapter);
  r.register(skillsCliAdapter);
  r.register(codexAdapter);
  r.register(openClawAdapter);
  r.register(hermesAdapter);
  return r;
}

export function run(): void {
  const program = new Command();
  program
    .name('freshkeeper')
    .description('Unified update keeper for AI coding agents')
    .version('0.1.0-alpha.0');

  program
    .command('list')
    .description('Show which supported agents are installed')
    .action(async () => {
      const r = buildRegistry();
      await printList(r);
    });

  program
    .command('check')
    .description('Show pending updates across installed agents')
    .action(async () => {
      const r = buildRegistry();
      await printCheck(r);
    });

  program
    .command('update')
    .description('Update all installed agents (CLI + plugins + skills)')
    .action(async () => {
      const r = buildRegistry();
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
      const r = buildRegistry();
      await runInit(r);
    });

  program.parse(process.argv);
}
