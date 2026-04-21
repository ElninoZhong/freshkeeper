import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import type { Adapter } from '../../src/adapters/types.js';

const fakeAdapter: Adapter = {
  id: 'fake',
  displayName: 'Fake Tool',
  async detect() { return { installed: true, version: '1.0.0' }; },
  async check() { return []; },
  async update() { return { updated: [], failed: [], logs: '' }; }
};

describe('Registry', () => {
  it('registers and lists adapters by id', () => {
    const r = new Registry();
    r.register(fakeAdapter);
    expect(r.list().map(a => a.id)).toEqual(['fake']);
    expect(r.get('fake')).toBe(fakeAdapter);
  });

  it('rejects duplicate ids', () => {
    const r = new Registry();
    r.register(fakeAdapter);
    expect(() => r.register(fakeAdapter)).toThrow(/already registered/);
  });
});
