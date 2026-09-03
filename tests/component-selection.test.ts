import { describe, expect, it } from 'vitest';
import { parseComponent, selectAdapterIds } from '../src/component-selection.js';

const codexAdapters = ['mcp-components', 'codex-plugins', 'skills-cli', 'codex'];

describe('component selection', () => {
  it('keeps all configured adapters by default', () => {
    expect(selectAdapterIds(codexAdapters, parseComponent(), 'codex')).toEqual(codexAdapters);
  });

  it('selects each independently runnable component', () => {
    expect(selectAdapterIds(codexAdapters, 'agent', 'codex')).toEqual(['codex']);
    expect(selectAdapterIds(codexAdapters, 'plugins', 'codex')).toEqual(['codex-plugins']);
    expect(selectAdapterIds(codexAdapters, 'skills', 'codex')).toEqual(['skills-cli']);
    expect(selectAdapterIds(codexAdapters, 'mcp', 'codex')).toEqual(['mcp-components']);
  });

  it('fails visibly for unknown or disabled components', () => {
    expect(() => parseComponent('everything')).toThrow(/unknown component/i);
    expect(() => selectAdapterIds(['codex'], 'plugins', 'codex')).toThrow(/not enabled/i);
  });
});
