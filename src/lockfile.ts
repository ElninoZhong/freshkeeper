import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const FRESHKEEPER_LOCK_FILENAME = 'freshkeeper.lock.json';

export interface ClaudeCodeLock {
  adapter: 'claude-code';
  version: string;
}

export interface ClaudePluginLockEntry {
  id: string;
  version: string;
  scope: 'user' | 'project' | 'local' | 'managed';
  enabled: boolean;
}

export interface ClaudePluginsLock {
  adapter: 'claude-plugins';
  plugins: ClaudePluginLockEntry[];
}

export interface LockedSkillEntry {
  source: string;
  ref: string;
  skillPath?: string;
  computedHash: string;
}

export interface SkillsCliLock {
  adapter: 'skills-cli';
  version: string;
  skills: Record<string, LockedSkillEntry>;
}

export type AdapterLockState = ClaudeCodeLock | ClaudePluginsLock | SkillsCliLock;

export interface FreshkeeperLockfile {
  version: 1;
  adapters: Record<string, AdapterLockState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeVersion(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} must be an exact semantic version`);
  }
}

function assertSafeSkillName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Unsafe skill name in ${FRESHKEEPER_LOCK_FILENAME}: ${name}`);
  }
}

function isGitHubSkillSource(source: string): boolean {
  return (
    /^[^/@\s]+\/[^/@\s]+$/.test(source) ||
    /^github:[^/@\s]+\/[^/@\s]+$/.test(source) ||
    /^https:\/\/github\.com\/[^/\s]+\/[^/#\s]+(?:\.git)?$/.test(source) ||
    /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/.test(source)
  );
}

function validateClaudeCodeLock(value: Record<string, unknown>): ClaudeCodeLock {
  if (value.adapter !== 'claude-code') throw new Error('Invalid claude-code lock entry');
  assertSafeVersion(value.version, 'claude-code version');
  return { adapter: 'claude-code', version: value.version };
}

function validateClaudePluginsLock(value: Record<string, unknown>): ClaudePluginsLock {
  if (value.adapter !== 'claude-plugins' || !Array.isArray(value.plugins)) {
    throw new Error('Invalid claude-plugins lock entry');
  }

  const allowedScopes = new Set(['user', 'project', 'local', 'managed']);
  const plugins = value.plugins.map((plugin): ClaudePluginLockEntry => {
    if (!isRecord(plugin)) throw new Error('Invalid Claude plugin lock item');
    if (typeof plugin.id !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(plugin.id)) {
      throw new Error('Invalid Claude plugin id in lockfile');
    }
    if (typeof plugin.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(plugin.version)) {
      throw new Error(`Invalid locked version for ${plugin.id}`);
    }
    if (typeof plugin.scope !== 'string' || !allowedScopes.has(plugin.scope)) {
      throw new Error(`Invalid locked scope for ${plugin.id}`);
    }
    if (typeof plugin.enabled !== 'boolean') throw new Error(`Invalid enabled state for ${plugin.id}`);
    return {
      id: plugin.id,
      version: plugin.version,
      scope: plugin.scope as ClaudePluginLockEntry['scope'],
      enabled: plugin.enabled
    };
  });

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { adapter: 'claude-plugins', plugins };
}

function validateSkillsCliLock(value: Record<string, unknown>): SkillsCliLock {
  if (value.adapter !== 'skills-cli' || !isRecord(value.skills)) {
    throw new Error('Invalid skills-cli lock entry');
  }
  assertSafeVersion(value.version, 'skills CLI version');

  const skills: Record<string, LockedSkillEntry> = {};
  for (const name of Object.keys(value.skills).sort()) {
    assertSafeSkillName(name);
    const entry = value.skills[name];
    if (!isRecord(entry)) throw new Error(`Invalid locked skill entry for ${name}`);
    if (typeof entry.source !== 'string' || !isGitHubSkillSource(entry.source)) {
      throw new Error(`Invalid locked source for ${name}`);
    }
    if (typeof entry.ref !== 'string' || !/^[0-9a-f]{40}$/i.test(entry.ref)) {
      throw new Error(`Locked skill ${name} must use an exact 40-character git commit`);
    }
    if (typeof entry.computedHash !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.computedHash)) {
      throw new Error(`Locked skill ${name} must include a SHA-256 content hash`);
    }
    if (entry.skillPath !== undefined) {
      if (typeof entry.skillPath !== 'string' || entry.skillPath.split(/[\\/]/).includes('..')) {
        throw new Error(`Invalid skillPath for ${name}`);
      }
    }
    skills[name] = {
      source: entry.source,
      ref: entry.ref.toLowerCase(),
      computedHash: entry.computedHash.toLowerCase(),
      ...(entry.skillPath ? { skillPath: entry.skillPath } : {})
    };
  }
  return { adapter: 'skills-cli', version: value.version, skills };
}

export function validateProjectLock(value: unknown): FreshkeeperLockfile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.adapters)) {
    throw new Error(`${FRESHKEEPER_LOCK_FILENAME} must use schema version 1`);
  }

  const adapters: Record<string, AdapterLockState> = {};
  for (const id of Object.keys(value.adapters).sort()) {
    const state = value.adapters[id];
    if (!isRecord(state)) throw new Error(`Invalid lock entry for adapter ${id}`);
    if (id === 'claude-code') adapters[id] = validateClaudeCodeLock(state);
    else if (id === 'claude-plugins') adapters[id] = validateClaudePluginsLock(state);
    else if (id === 'skills-cli') adapters[id] = validateSkillsCliLock(state);
    else throw new Error(`Unsupported adapter in ${FRESHKEEPER_LOCK_FILENAME}: ${id}`);
  }
  return { version: 1, adapters };
}

export function writeProjectLock(lock: FreshkeeperLockfile, projectDir: string): string {
  const canonical = validateProjectLock(lock);
  const lockPath = join(resolve(projectDir), FRESHKEEPER_LOCK_FILENAME);
  const tempPath = `${lockPath}.freshkeeper-${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(canonical, null, 2)}\n`, 'utf-8');
    renameSync(tempPath, lockPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
  return lockPath;
}

export function loadProjectLock(startDir: string): {
  projectDir: string;
  lockPath: string;
  lock: FreshkeeperLockfile;
} {
  let current = resolve(startDir);
  while (true) {
    const lockPath = join(current, FRESHKEEPER_LOCK_FILENAME);
    if (existsSync(lockPath)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(lockPath, 'utf-8'));
      } catch (error) {
        throw new Error(`Unable to parse ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { projectDir: current, lockPath, lock: validateProjectLock(parsed) };
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`No ${FRESHKEEPER_LOCK_FILENAME} found from ${startDir}`);
    current = parent;
  }
}
