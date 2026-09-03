import type { AgentTarget } from './config.js';

export type ComponentSelection = 'all' | 'agent' | 'plugins' | 'skills' | 'mcp';

const COMPONENTS = new Set<ComponentSelection>(['all', 'agent', 'plugins', 'skills', 'mcp']);

const AGENT_ADAPTER: Record<AgentTarget, string> = {
  claude: 'claude-code',
  codex: 'codex',
  openclaw: 'openclaw',
  hermes: 'hermes'
};

export function parseComponent(value?: string): ComponentSelection {
  const component = value ?? 'all';
  if (!COMPONENTS.has(component as ComponentSelection)) {
    throw new Error(`Unknown component: ${component}. Choose all, agent, plugins, skills, or mcp.`);
  }
  return component as ComponentSelection;
}

export function selectAdapterIds(
  enabledAdapterIds: string[],
  component: ComponentSelection,
  primaryAgent: AgentTarget | null
): string[] {
  if (component === 'all') return [...enabledAdapterIds];

  const selected = enabledAdapterIds.filter((id) => {
    if (component === 'plugins') return id === 'codex-plugins' || id === 'claude-plugins';
    if (component === 'skills') return id === 'skills-cli';
    if (component === 'mcp') return id === 'mcp-components';
    return primaryAgent ? id === AGENT_ADAPTER[primaryAgent] : false;
  });

  if (selected.length === 0) {
    throw new Error(`Component "${component}" is not enabled for the configured primary agent.`);
  }
  return selected;
}
