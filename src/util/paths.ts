import { homedir } from 'node:os';
import { join } from 'node:path';

export function freshkeeperHome(): string {
  return process.env.FRESHKEEPER_HOME ?? join(homedir(), '.freshkeeper');
}

export function configPath(): string {
  return join(freshkeeperHome(), 'config.json');
}

export function logPath(): string {
  return join(freshkeeperHome(), 'freshkeeper.log');
}
