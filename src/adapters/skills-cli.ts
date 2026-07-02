import { safeExec } from '../util/exec.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Adapter } from './types.js';

const SKILLS_TIMEOUT_MS = 8_000;

function resolveProjectDir(): string | undefined {
  if (process.env.FRESHKEEPER_SKILLS_CWD) {
    const explicitPath = process.env.FRESHKEEPER_SKILLS_CWD;
    return existsSync(join(explicitPath, 'skills-lock.json')) ? explicitPath : undefined;
  }

  const candidates = [
    process.cwd(),
    join(homedir(), 'Documents/Claude')
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(join(p, 'skills-lock.json')));
}

interface SkillsCommand {
  cmd: string;
  argsPrefix: string[];
  label: string;
}

interface ProjectSkill {
  name: string;
  source: string;
}

function cachedSkillsCli(): string | undefined {
  const npxDir = join(homedir(), '.npm', '_npx');
  if (!existsSync(npxDir)) return undefined;

  const candidates = readdirSync(npxDir)
    .map((entry) => join(npxDir, entry, 'node_modules', 'skills', 'bin', 'cli.mjs'))
    .filter((entry) => existsSync(entry))
    .map((entry) => ({ entry, mtimeMs: statSync(entry).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.entry;
}

function skillsCommands(): SkillsCommand[] {
  const commands: SkillsCommand[] = [];

  if (process.env.FRESHKEEPER_SKILLS_BIN) {
    commands.push({
      cmd: process.env.FRESHKEEPER_SKILLS_BIN,
      argsPrefix: [],
      label: 'FRESHKEEPER_SKILLS_BIN'
    });
  }

  commands.push({ cmd: 'skills', argsPrefix: [], label: 'skills' });

  const cached = process.env.FRESHKEEPER_SKILLS_DISABLE_CACHE === '1' ? undefined : cachedSkillsCli();
  if (cached) {
    commands.push({
      cmd: process.execPath,
      argsPrefix: [cached],
      label: 'cached skills CLI'
    });
  }

  commands.push({ cmd: 'npx', argsPrefix: ['skills'], label: 'npx skills' });
  return commands;
}

async function resolveSkillsCommand(): Promise<{ command?: SkillsCommand; version?: string; errors: string[] }> {
  const errors: string[] = [];

  for (const command of skillsCommands()) {
    const r = await safeExec(command.cmd, [...command.argsPrefix, '--version'], { timeoutMs: SKILLS_TIMEOUT_MS });
    if (r.ok) {
      return {
        command,
        version: r.stdout.trim().split('\n').pop(),
        errors
      };
    }

    const message = r.error || r.stderr || `exit ${r.exitCode ?? 'unknown'}`;
    errors.push(`${command.label}: ${message}`);
  }

  return { errors };
}

function githubProjectSkills(cwd: string | undefined): ProjectSkill[] {
  if (!cwd) return [];
  const lockPath = join(cwd, 'skills-lock.json');
  if (!existsSync(lockPath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
      skills?: Record<string, { source?: string; sourceType?: string; skillPath?: string }>;
    };

    return Object.entries(parsed.skills ?? {})
      .filter(([, entry]) => entry.sourceType === 'github' && entry.source)
      .map(([name, entry]) => ({ name, source: entry.source as string }));
  } catch {
    return [];
  }
}

export const skillsCliAdapter: Adapter = {
  id: 'skills-cli',
  displayName: 'Skills CLI (skills.sh)',

  async detect() {
    const resolved = await resolveSkillsCommand();
    if (!resolved.command) return { installed: false };
    return { installed: true, version: resolved.version };
  },

  async check() {
    return [];
  },

  async update() {
    const cwd = resolveProjectDir();
    const resolved = await resolveSkillsCommand();
    if (!resolved.command) {
      return {
        updated: [],
        failed: [{
          item: 'skills',
          error: `skills CLI unavailable. Tried: ${resolved.errors.join('; ')}`
        }],
        logs: ''
      };
    }

    const projectSkills = githubProjectSkills(cwd);
    if (projectSkills.length > 0) {
      const failed: { item: string; error: string }[] = [];
      let refreshed = 0;
      let logs = `Refreshing ${projectSkills.length} project skill(s) from skills-lock.json...\n`;

      for (const skill of projectSkills) {
        const refresh = await safeExec(
          resolved.command.cmd,
          [...resolved.command.argsPrefix, 'add', skill.source, '--skill', skill.name, '--agent', 'universal', '-y'],
          { cwd, timeoutMs: 120_000 }
        );

        logs += `\n[skill:${skill.name}]\n${refresh.stdout}${refresh.stderr ? `\n${refresh.stderr}` : ''}\n`;
        if (refresh.ok) {
          refreshed += 1;
        } else {
          failed.push({
            item: skill.name,
            error: refresh.stderr || refresh.error || 'skill refresh failed'
          });
        }
      }

      return {
        updated: refreshed > 0 ? [`${refreshed} skills`] : [],
        failed,
        logs
      };
    }

    const r = await safeExec(
      resolved.command.cmd,
      [...resolved.command.argsPrefix, 'update', '-y'],
      { cwd, timeoutMs: 300_000 }
    );
    const count = r.stdout.match(/Updated\s+(\d+)\s+skill/)?.[1];
    const updated = count ? [`${count} skills`] : [];
    const failed = r.ok ? [] : [{ item: 'skills', error: r.stderr || r.error || 'update failed' }];

    return {
      updated,
      failed,
      logs: r.stdout
    };
  }
};
