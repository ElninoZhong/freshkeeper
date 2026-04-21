import { safeExec } from '../util/exec.js';

export const markerBegin = '# >>> freshkeeper >>>';
export const markerEnd = '# <<< freshkeeper <<<';

export async function resolveBinary(): Promise<string> {
  if (process.env.FRESHKEEPER_BIN) return process.env.FRESHKEEPER_BIN;
  const which = await safeExec('which', ['freshkeeper']);
  if (which.ok && which.stdout.trim()) return which.stdout.trim();
  return 'freshkeeper';
}

export function renderCrontabLine(cron: string, binary = 'freshkeeper'): string {
  return `${cron}  ${binary} update >> $HOME/.freshkeeper/cron.log 2>&1`;
}

export function injectIntoCrontab(existing: string, cron: string, binary = 'freshkeeper'): string {
  const block = `${markerBegin}\n${renderCrontabLine(cron, binary)}\n${markerEnd}`;
  const re = new RegExp(`${markerBegin}[\\s\\S]*?${markerEnd}`, 'm');
  if (re.test(existing)) return existing.replace(re, block);
  return (existing.endsWith('\n') || existing.length === 0 ? existing : existing + '\n') + block + '\n';
}

export async function installCrontab(cron: string): Promise<void> {
  const existing = await safeExec('crontab', ['-l']);
  const current = existing.ok ? existing.stdout : '';
  const binary = await resolveBinary();
  const next = injectIntoCrontab(current, cron, binary);
  const write = await safeExec('bash', ['-c', `echo ${JSON.stringify(next)} | crontab -`]);
  if (!write.ok) throw new Error(`crontab write failed: ${write.stderr}`);
}

export async function uninstallCrontab(): Promise<void> {
  const existing = await safeExec('crontab', ['-l']);
  if (!existing.ok) return;
  const stripped = existing.stdout.replace(new RegExp(`${markerBegin}[\\s\\S]*?${markerEnd}\\n?`, 'm'), '');
  await safeExec('bash', ['-c', `echo ${JSON.stringify(stripped)} | crontab -`]);
}
