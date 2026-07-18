import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

const SKILLS_TIMEOUT_MS = 8_000;
const PINNED_SKILLS_NPX_PACKAGE = 'skills@1.5.16';

interface SkillsCommand {
  cmd: string;
  argsPrefix: string[];
  label: string;
}

interface ProjectSkill {
  name: string;
  source: string;
}

type SkillsUpdatePlan =
  | { kind: 'project'; cwd: string; skills: ProjectSkill[] }
  | { kind: 'global' }
  | { kind: 'skip'; reason: string }
  | { kind: 'error'; error: string };

function findLockDirectory(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, 'skills-lock.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function projectSkills(cwd: string): SkillsUpdatePlan {
  const lockPath = join(cwd, 'skills-lock.json');
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
      skills?: Record<string, { source?: string; sourceType?: string; skillPath?: string }>;
    };
    if (!parsed.skills || typeof parsed.skills !== 'object' || Array.isArray(parsed.skills)) {
      return { kind: 'error', error: `${lockPath} does not contain a valid skills object` };
    }

    const skills = Object.entries(parsed.skills)
      .filter(([, entry]) => entry.sourceType === 'github' && typeof entry.source === 'string' && entry.source.length > 0)
      .map(([name, entry]) => ({ name, source: entry.source as string }));

    if (skills.length === 0) {
      return { kind: 'skip', reason: `Skipped skills update: ${lockPath} has no GitHub-backed skills.` };
    }
    return { kind: 'project', cwd, skills };
  } catch (error) {
    return {
      kind: 'error',
      error: `Unable to parse ${lockPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function resolveSkillsUpdatePlan(): SkillsUpdatePlan {
  const explicitCwd = process.env.FRESHKEEPER_SKILLS_CWD;
  if (explicitCwd) {
    const cwd = resolve(explicitCwd);
    if (!existsSync(join(cwd, 'skills-lock.json'))) {
      return { kind: 'skip', reason: `Skipped skills update: no skills-lock.json in ${cwd}.` };
    }
    return projectSkills(cwd);
  }

  const discovered = findLockDirectory(process.cwd());
  if (discovered) return projectSkills(discovered);
  if (process.env.FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE === '1') return { kind: 'global' };
  return {
    kind: 'skip',
    reason: 'Skipped global skills update. Set FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1 to opt in explicitly.'
  };
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
  commands.push({
    cmd: 'npx',
    argsPrefix: ['--yes', PINNED_SKILLS_NPX_PACKAGE],
    label: `npx ${PINNED_SKILLS_NPX_PACKAGE}`
  });
  return commands;
}

async function resolveSkillsCommand(): Promise<{ command?: SkillsCommand; version?: string; errors: string[] }> {
  const errors: string[] = [];

  for (const command of skillsCommands()) {
    const result = await safeExec(command.cmd, [...command.argsPrefix, '--version'], { timeoutMs: SKILLS_TIMEOUT_MS });
    if (result.ok) {
      return {
        command,
        version: result.stdout.trim().split('\n').pop(),
        errors
      };
    }

    const message = result.error || result.stderr || `exit ${result.exitCode ?? 'unknown'}`;
    errors.push(`${command.label}: ${message}`);
  }

  return { errors };
}

export const skillsCliAdapter: Adapter = {
  id: 'skills-cli',
  displayName: 'Skills CLI (skills.sh)',

  async detect() {
    const resolvedCommand = await resolveSkillsCommand();
    if (!resolvedCommand.command) return { installed: false };
    return { installed: true, version: resolvedCommand.version };
  },

  async check() {
    return [];
  },

  async update() {
    const plan = resolveSkillsUpdatePlan();
    if (plan.kind === 'skip') return { updated: [], failed: [], logs: plan.reason };
    if (plan.kind === 'error') {
      return {
        updated: [],
        failed: [{ item: 'skills-lock.json', error: plan.error }],
        logs: ''
      };
    }

    const resolvedCommand = await resolveSkillsCommand();
    if (!resolvedCommand.command) {
      return {
        updated: [],
        failed: [{
          item: 'skills',
          error: `skills CLI unavailable. Tried: ${resolvedCommand.errors.join('; ')}`
        }],
        logs: ''
      };
    }

    if (plan.kind === 'project') {
      const failed: { item: string; error: string }[] = [];
      let refreshed = 0;
      let logs = `Refreshing ${plan.skills.length} project skill(s) from skills-lock.json...\n`;

      for (const skill of plan.skills) {
        const refresh = await safeExec(
          resolvedCommand.command.cmd,
          [...resolvedCommand.command.argsPrefix, 'add', skill.source, '--skill', skill.name, '--agent', 'universal', '-y'],
          { cwd: plan.cwd, timeoutMs: 120_000 }
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

    const result = await safeExec(
      resolvedCommand.command.cmd,
      [...resolvedCommand.command.argsPrefix, 'update', '-y'],
      { timeoutMs: 300_000 }
    );
    const count = result.stdout.match(/Updated\s+(\d+)\s+skill/)?.[1];
    const updated = count ? [`${count} skills`] : [];
    const failed = result.ok ? [] : [{ item: 'skills', error: result.stderr || result.error || 'update failed' }];

    return {
      updated,
      failed,
      logs: result.stdout
    };
  }
};
