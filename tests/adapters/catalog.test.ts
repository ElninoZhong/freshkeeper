import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/adapters/catalog.js';

describe('adapter catalog', () => {
  it('registers only adapters enabled by configuration', () => {
    const registry = buildRegistry(['claude-code', 'skills-cli']);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['claude-code', 'skills-cli']);
  });

  it('rejects unknown adapter ids instead of silently ignoring configuration mistakes', () => {
    expect(() => buildRegistry(['claude-code', 'missing-adapter'])).toThrow(/unknown adapter/i);
  });
});
