import { claudeCodeAdapter } from './claude-code.js';
import { claudePluginsAdapter } from './claude-plugins.js';
import { codexAdapter } from './codex.js';
import { hermesAdapter } from './hermes.js';
import { openClawAdapter } from './openclaw.js';
import { Registry } from './registry.js';
import { skillsCliAdapter } from './skills-cli.js';
import type { Adapter } from './types.js';

const knownAdapters: Adapter[] = [
  claudeCodeAdapter,
  claudePluginsAdapter,
  skillsCliAdapter,
  codexAdapter,
  openClawAdapter,
  hermesAdapter
];

const adaptersById = new Map(knownAdapters.map((adapter) => [adapter.id, adapter]));

export function buildRegistry(enabledAdapterIds: string[]): Registry {
  const registry = new Registry();
  for (const id of enabledAdapterIds) {
    const adapter = adaptersById.get(id);
    if (!adapter) throw new Error(`Unknown adapter in configuration: ${id}`);
    registry.register(adapter);
  }
  return registry;
}
