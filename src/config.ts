import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { configPath, freshkeeperHome } from './util/paths.js';

export interface Config {
  enabledAdapters: string[];
  schedule: { enabled: boolean; cron: string } | null;
  notify: { enabled: boolean; macNotification: boolean };
}

export function defaultConfig(): Config {
  return {
    enabledAdapters: ['claude-code', 'claude-plugins', 'skills-cli', 'codex', 'openclaw', 'hermes'],
    schedule: null,
    notify: { enabled: true, macNotification: false }
  };
}

export function loadConfig(): Config {
  const p = configPath();
  if (!existsSync(p)) return defaultConfig();
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function saveConfig(cfg: Config): void {
  mkdirSync(freshkeeperHome(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
