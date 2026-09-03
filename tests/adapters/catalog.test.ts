import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/adapters/catalog.js';

describe('adapter catalog', () => {
  it('registers only adapters enabled by configuration', () => {
    const registry = buildRegistry(['claude-code', 'skills-cli']);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['claude-code', 'skills-cli']);
  });

  it('exposes the ownership-aware MCP adapter through the registry seam', () => {
    const registry = buildRegistry(['mcp-components']);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['mcp-components']);
  });

  it('exposes Codex plugins as an independently selectable adapter', () => {
    const registry = buildRegistry(['codex-plugins']);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['codex-plugins']);
  });

  it('rejects unknown adapter ids instead of silently ignoring configuration mistakes', () => {
    expect(() => buildRegistry(['claude-code', 'missing-adapter'])).toThrow(/unknown adapter/i);
  });
});
