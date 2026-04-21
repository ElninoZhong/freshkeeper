import { safeExec } from '../util/exec.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Adapter } from './types.js';

function resolveProjectDir(): string | undefined {
  const candidates = [
    process.env.FRESHKEEPER_SKILLS_CWD,
    process.cwd(),
    join(homedir(), 'Documents/Claude')
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(join(p, 'skills-lock.json')));
}

export const skillsCliAdapter: Adapter = {
  id: 'skills-cli',
  displayName: 'Skills CLI (skills.sh)',

  async detect() {
    const r = await safeExec('npx', ['skills', '--version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.trim().split('\n').pop();
    return { installed: true, version };
  },

  async check() {
    return [];
  },

  async update() {
    const cwd = resolveProjectDir();
    const r = await safeExec('npx', ['skills', 'update', '-y'], { cwd });
    const count = r.stdout.match(/Updated\s+(\d+)\s+skill/)?.[1];
    return {
      updated: count ? [`${count} skills`] : [],
      failed: r.ok ? [] : [{ item: 'skills', error: r.stderr || 'update failed' }],
      logs: r.stdout
    };
  }
};
