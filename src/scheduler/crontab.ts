import cron from 'node-cron';
import { safeExec } from '../util/exec.js';
import type { ExecResult } from '../util/exec.js';

export const markerBegin = '# >>> freshkeeper >>>';
export const markerEnd = '# <<< freshkeeper <<<';

function validateCronExpression(value: string): void {
  const fields = value.trim().split(/\s+/);
  if (
    value !== value.trim()
    || value.includes('\n')
    || value.includes('\r')
    || value.includes('\0')
    || fields.length !== 5
    || !cron.validate(value)
  ) {
    throw new Error(`Invalid cron expression: ${JSON.stringify(value)}`);
  }
}

function shellQuote(value: string): string {
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    throw new Error('Freshkeeper binary path contains an invalid control character');
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readCrontab(result: ExecResult): string | undefined {
  if (result.ok) return result.stdout;
  const detail = result.stderr || result.error || `exit ${result.exitCode ?? 'unknown'}`;
  if (/no crontab for/i.test(detail)) return undefined;
  throw new Error(`crontab read failed: ${detail}`);
}

function writeError(result: ExecResult): string {
  return result.stderr || result.error || `exit ${result.exitCode ?? 'unknown'}`;
}

export async function resolveBinary(): Promise<string> {
  if (process.env.FRESHKEEPER_BIN) return process.env.FRESHKEEPER_BIN;
  const which = await safeExec('which', ['freshkeeper']);
  if (which.ok && which.stdout.trim()) return which.stdout.trim();
  return 'freshkeeper';
}

export function renderCrontabLine(cronExpression: string, binary = 'freshkeeper'): string {
  return `${cronExpression}  ${shellQuote(binary)} update >> $HOME/.freshkeeper/cron.log 2>&1`;
}

export function injectIntoCrontab(existing: string, cronExpression: string, binary = 'freshkeeper'): string {
  const block = `${markerBegin}\n${renderCrontabLine(cronExpression, binary)}\n${markerEnd}`;
  const re = new RegExp(`${markerBegin}[\\s\\S]*?${markerEnd}`, 'm');
  if (re.test(existing)) return existing.replace(re, block);
  return (existing.endsWith('\n') || existing.length === 0 ? existing : existing + '\n') + block + '\n';
}

export async function installCrontab(cronExpression: string): Promise<void> {
  validateCronExpression(cronExpression);
  const existing = await safeExec('crontab', ['-l']);
  const current = readCrontab(existing) ?? '';
  const binary = await resolveBinary();
  const next = injectIntoCrontab(current, cronExpression, binary);
  const write = await safeExec('crontab', ['-'], { input: next });
  if (!write.ok) throw new Error(`crontab write failed: ${writeError(write)}`);
}

export async function uninstallCrontab(): Promise<void> {
  const existing = await safeExec('crontab', ['-l']);
  const current = readCrontab(existing);
  if (current === undefined) return;
  const stripped = current.replace(new RegExp(`${markerBegin}[\\s\\S]*?${markerEnd}\\n?`, 'm'), '');
  if (stripped === current) return;
  const write = await safeExec('crontab', ['-'], { input: stripped });
  if (!write.ok) throw new Error(`crontab write failed: ${writeError(write)}`);
}
