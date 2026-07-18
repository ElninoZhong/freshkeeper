import { describe, it, expect } from 'vitest';
import { safeExec } from '../../src/util/exec.js';

describe('safeExec', () => {
  it('returns stdout on success', async () => {
    const r = await safeExec('node', ['-e', 'console.log("hi")']);
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('hi');
  });

  it('returns ok=false on non-zero exit', async () => {
    const r = await safeExec('node', ['-e', 'process.exit(2)']);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
  });

  it('returns ok=false when binary missing', async () => {
    const r = await safeExec('this-binary-does-not-exist-xyz', []);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('passes input directly to the child process', async () => {
    const r = await safeExec(
      'node',
      ['-e', 'process.stdin.setEncoding("utf8"); let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => console.log(s));'],
      { input: 'safe stdin' }
    );

    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('safe stdin');
  });
});
