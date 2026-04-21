import { Command } from 'commander';
import { Registry } from './adapters/registry.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { claudePluginsAdapter } from './adapters/claude-plugins.js';
import { skillsCliAdapter } from './adapters/skills-cli.js';
import { printList } from './commands/list.js';

function buildRegistry(): Registry {
  const r = new Registry();
  r.register(claudeCodeAdapter);
  r.register(claudePluginsAdapter);
  r.register(skillsCliAdapter);
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

  program.parse(process.argv);
}
