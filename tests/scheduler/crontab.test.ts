import { describe, it, expect } from 'vitest';
import { renderCrontabLine, markerBegin, markerEnd, injectIntoCrontab } from '../../src/scheduler/crontab.js';

describe('crontab rendering', () => {
  it('renders line with cron expression and freshkeeper update command', () => {
    const line = renderCrontabLine('0 10 * * 1', 'freshkeeper');
    expect(line).toMatch(/^0 10 \* \* 1\s+.+freshkeeper update/);
  });

  it('wraps content in managed block when injecting', () => {
    const existing = 'existing\n';
    const newTab = injectIntoCrontab(existing, '0 10 * * 1', 'freshkeeper');
    expect(newTab).toContain(markerBegin);
    expect(newTab).toContain(markerEnd);
    expect(newTab).toContain('existing');
  });

  it('replaces existing managed block on re-inject', () => {
    const existing = `${markerBegin}\n0 9 * * * old\n${markerEnd}\nother\n`;
    const newTab = injectIntoCrontab(existing, '0 10 * * 1', 'freshkeeper');
    expect(newTab).not.toContain('old');
    expect(newTab).toContain('other');
    expect((newTab.match(new RegExp(markerBegin, 'g')) || []).length).toBe(1);
  });
});
