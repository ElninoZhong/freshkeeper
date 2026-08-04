import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FRESHKEEPER_LOCK_FILENAME,
  loadProjectLock,
  writeProjectLock,
  type FreshkeeperLockfile
} from '../src/lockfile.js';

const validLock: FreshkeeperLockfile = {
  version: 1,
  adapters: {
    'claude-code': { adapter: 'claude-code', version: '2.1.116' }
  }
};

describe('project lockfile', () => {
  it('writes deterministic JSON and finds the nearest parent lock', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'freshkeeper-lock-'));
    const nestedDir = join(projectDir, 'packages', 'demo');
    mkdirSync(nestedDir, { recursive: true });

    const lockPath = writeProjectLock(validLock, projectDir);
    const loaded = loadProjectLock(nestedDir);

    expect(lockPath).toBe(join(projectDir, FRESHKEEPER_LOCK_FILENAME));
    expect(loaded).toEqual({ projectDir, lockPath, lock: validLock });
    expect(readFileSync(lockPath, 'utf-8')).toBe(`${JSON.stringify(validLock, null, 2)}\n`);
  });

  it('fails closed on malformed or unsafe lock entries', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'freshkeeper-lock-invalid-'));
    writeFileSync(join(projectDir, FRESHKEEPER_LOCK_FILENAME), JSON.stringify({
      version: 1,
      adapters: {
        'skills-cli': {
          adapter: 'skills-cli',
          version: '1.5.16',
          skills: {
            '../escape': {
              source: 'owner/repo',
              ref: 'a'.repeat(40),
              computedHash: 'b'.repeat(64)
            }
          }
        }
      }
    }));

    expect(() => loadProjectLock(projectDir)).toThrow(/unsafe skill name/i);
  });
});
