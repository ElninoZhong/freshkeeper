import readline from 'node:readline/promises';
import { Registry } from '../adapters/registry.js';
import { printList } from './list.js';
import { printUpdate } from './update.js';
import { runSchedule } from './schedule.js';
import { log } from '../logger.js';

export async function runInit(registry: Registry): Promise<void> {
  log.info('Welcome to Freshkeeper. Detecting installed agents...');
  await printList(registry);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const runNow = (await rl.question('\nRun an update right now? [Y/n] ')).trim().toLowerCase();
  if (runNow !== 'n') await printUpdate(registry);

  const schedule = (await rl.question('\nSet a weekly auto-update (Monday 10:00)? [Y/n] ')).trim().toLowerCase();
  if (schedule !== 'n') await runSchedule('0 10 * * 1');

  rl.close();
  log.success('Freshkeeper is set up. Run `freshkeeper update` anytime, or let the schedule handle it.');
}
