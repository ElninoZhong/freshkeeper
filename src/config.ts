import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { configPath, freshkeeperHome } from './util/paths.js';

export type AgentTarget = 'claude' | 'codex' | 'openclaw' | 'hermes';
export type MemoryProvider = 'claude' | 'codex' | 'gemini' | 'openrouter';

export interface Config {
  primaryAgent: AgentTarget | null;
  memoryProvider: MemoryProvider | null;
  enabledAdapters: string[];
  schedule: { enabled: boolean; cron: string } | null;
  notify: { enabled: boolean; macNotification: boolean };
}

const ADAPTERS_BY_AGENT: Record<AgentTarget, string[]> = {
  claude: ['mcp-components', 'claude-code', 'claude-plugins', 'skills-cli'],
  codex: ['mcp-components', 'codex-plugins', 'skills-cli', 'codex'],
  openclaw: ['skills-cli', 'openclaw'],
  hermes: ['skills-cli', 'hermes']
};

export function defaultConfig(): Config {
  return {
    primaryAgent: null,
    memoryProvider: null,
    enabledAdapters: [],
    schedule: null,
    notify: { enabled: true, macNotification: false }
  };
}

export function configForAgent(agent: AgentTarget, base: Config = defaultConfig()): Config {
  return configForSelections({ primaryAgent: agent, memoryProvider: base.memoryProvider }, base);
}

export function configForSelections(
  selections: { primaryAgent: AgentTarget; memoryProvider: MemoryProvider | null },
  base: Config = defaultConfig()
): Config {
  return {
    ...base,
    primaryAgent: selections.primaryAgent,
    memoryProvider: selections.memoryProvider,
    enabledAdapters: [...ADAPTERS_BY_AGENT[selections.primaryAgent]]
  };
}

function inferPrimaryAgent(enabledAdapters: string[]): AgentTarget | null {
  const matches: AgentTarget[] = [];
  if (enabledAdapters.includes('codex')) matches.push('codex');
  if (enabledAdapters.includes('claude-code') || enabledAdapters.includes('claude-plugins')) matches.push('claude');
  if (enabledAdapters.includes('openclaw')) matches.push('openclaw');
  if (enabledAdapters.includes('hermes')) matches.push('hermes');
  return matches.length === 1 ? matches[0] : null;
}

export function loadConfig(): Config {
  const p = configPath();
  if (!existsSync(p)) return defaultConfig();
  const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<Config>;
  const defaults = defaultConfig();
  const enabledAdapters = parsed.enabledAdapters ?? defaults.enabledAdapters;
  return {
    ...defaults,
    ...parsed,
    primaryAgent: parsed.primaryAgent !== undefined
      ? parsed.primaryAgent
      : inferPrimaryAgent(enabledAdapters),
    enabledAdapters
  };
}

export function saveConfig(cfg: Config): void {
  mkdirSync(freshkeeperHome(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
