import { claudeCodeAdapter } from './claude-code.js';
import { claudePluginsAdapter } from './claude-plugins.js';
import { codexAdapter } from './codex.js';
import { codexPluginsAdapter } from './codex-plugins.js';
import { hermesAdapter } from './hermes.js';
import { mcpComponentsAdapter } from './mcp-components.js';
import { openClawAdapter } from './openclaw.js';
import { Registry } from './registry.js';
import { skillsCliAdapter } from './skills-cli.js';
import type { Adapter } from './types.js';

const knownAdapters: Adapter[] = [
  mcpComponentsAdapter,
  claudeCodeAdapter,
  claudePluginsAdapter,
  codexPluginsAdapter,
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
