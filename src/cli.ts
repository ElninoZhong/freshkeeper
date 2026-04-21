import { Command } from 'commander';

export function run(): void {
  const program = new Command();
  program
    .name('freshkeeper')
    .description('Unified update keeper for AI coding agents')
    .version('0.1.0-alpha.0');

  program.parse(process.argv);
}
