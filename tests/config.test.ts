import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, defaultConfig } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fk-'));
  process.env.FRESHKEEPER_HOME = dir;
});

describe('config', () => {
  it('returns defaults when file missing', () => {
    const cfg = loadConfig();
    expect(cfg).toEqual(defaultConfig());
  });

  it('loads written config', () => {
    const written = { ...defaultConfig(), enabledAdapters: ['claude-code'] };
    saveConfig(written);
    expect(loadConfig()).toEqual(written);
  });
});
