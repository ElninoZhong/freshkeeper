import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, defaultConfig, configForAgent, configForSelections } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fk-'));
  process.env.FRESHKEEPER_HOME = dir;
});

describe('config', () => {
  it('returns defaults when file missing', () => {
    const cfg = loadConfig();
    expect(cfg).toEqual(defaultConfig());
    expect(cfg.primaryAgent).toBeNull();
    expect(cfg.enabledAdapters).toEqual([]);
  });

  it('loads written config', () => {
    const written = { ...defaultConfig(), enabledAdapters: ['claude-code'] };
    saveConfig(written);
    expect(loadConfig()).toEqual(written);
  });

  it('maps the user-selected agent to its adapter plan without changing product defaults', () => {
    expect(configForAgent('codex').enabledAdapters).toEqual([
      'mcp-components',
      'codex-plugins',
      'skills-cli',
      'codex'
    ]);
    expect(configForAgent('claude').enabledAdapters).toEqual([
      'mcp-components',
      'claude-code',
      'claude-plugins',
      'skills-cli'
    ]);
    expect(configForAgent('openclaw').enabledAdapters).toEqual(['skills-cli', 'openclaw']);
    expect(configForAgent('hermes').enabledAdapters).toEqual(['skills-cli', 'hermes']);
    expect(configForAgent('codex').primaryAgent).toBe('codex');
    expect(defaultConfig().primaryAgent).toBeNull();
  });

  it('keeps the memory provider independent from the primary agent', () => {
    const config = configForSelections({
      primaryAgent: 'codex',
      memoryProvider: 'codex'
    });

    expect(config.primaryAgent).toBe('codex');
    expect(config.memoryProvider).toBe('codex');
    expect(config.enabledAdapters).toEqual(['mcp-components', 'codex-plugins', 'skills-cli', 'codex']);
  });
});
