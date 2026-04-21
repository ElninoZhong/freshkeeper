# Freshkeeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `freshkeeper`, a cross-agent update manager that detects installed AI coding agents (Claude Code, Codex, OpenClaw, Hermes) on a user's machine, updates them with one command, aggregates changelogs, and optionally runs on a schedule.

**Architecture:** TypeScript CLI published to npm. Pluggable "adapter" pattern — each supported agent has an adapter implementing a common `Adapter` interface (detect / check / update). A central registry loads enabled adapters, commander.js handles CLI parsing, node-cron + system crontab/launchd handle scheduling. Changelog aggregation pulls from GitHub Releases API + npm registry.

**Tech Stack:** TypeScript 5.x, Node.js ≥20, commander ≥12, vitest ≥1, execa ≥9, chalk ≥5, ink ≥5 (for interactive init), node-cron ≥3, simple-git ≥3. Distributed via npm as `freshkeeper`.

**Positioning:** "OpenClaw、Hermes、Claude Code、Codex 用户的统一更新管家"

---

## File Structure

```
freshkeeper/
├── package.json              # npm manifest, bin entry, dependencies
├── tsconfig.json             # TS config (ES2022 target, NodeNext modules)
├── vitest.config.ts          # test runner config
├── README.md                 # landing page, install + usage
├── README.zh-CN.md           # Chinese readme (primary audience)
├── LICENSE                   # MIT
├── .github/
│   └── workflows/
│       ├── ci.yml            # run tests on PRs
│       └── release.yml       # publish to npm on tag push
├── bin/
│   └── freshkeeper.js        # shebang launcher -> dist/cli.js
├── src/
│   ├── cli.ts                # commander entry — wires all commands
│   ├── commands/
│   │   ├── check.ts          # `freshkeeper check`
│   │   ├── update.ts         # `freshkeeper update`
│   │   ├── schedule.ts       # `freshkeeper schedule`
│   │   ├── init.ts           # `freshkeeper init` — interactive setup
│   │   └── list.ts           # `freshkeeper list` — show detected agents
│   ├── adapters/
│   │   ├── types.ts          # Adapter interface + shared types
│   │   ├── registry.ts       # adapter registration + loading
│   │   ├── claude-code.ts    # adapter: Claude Code CLI itself
│   │   ├── claude-plugins.ts # adapter: claude plugin update
│   │   ├── skills-cli.ts     # adapter: npx skills update
│   │   ├── codex.ts          # adapter: OpenAI Codex CLI
│   │   ├── openclaw.ts       # adapter: OpenClaw
│   │   └── hermes.ts         # adapter: Hermes Agent
│   ├── scheduler/
│   │   ├── index.ts          # platform dispatcher
│   │   ├── crontab.ts        # Linux/macOS crontab setup
│   │   └── launchd.ts        # macOS launchd plist setup (preferred on mac)
│   ├── changelog/
│   │   ├── github.ts         # GitHub Releases API fetcher
│   │   ├── npm.ts            # npm registry fetcher
│   │   └── aggregate.ts      # merge + format changelogs
│   ├── config.ts             # ~/.freshkeeper/config.json loader
│   ├── logger.ts             # formatted logger (chalk)
│   └── util/
│       ├── exec.ts           # execa wrapper with logging
│       └── paths.ts          # ~/.freshkeeper path helpers
├── tests/
│   ├── adapters/
│   │   ├── claude-code.test.ts
│   │   ├── claude-plugins.test.ts
│   │   ├── skills-cli.test.ts
│   │   ├── codex.test.ts
│   │   ├── openclaw.test.ts
│   │   └── hermes.test.ts
│   ├── scheduler/
│   │   ├── crontab.test.ts
│   │   └── launchd.test.ts
│   ├── changelog/
│   │   └── aggregate.test.ts
│   ├── commands/
│   │   ├── check.test.ts
│   │   ├── update.test.ts
│   │   └── schedule.test.ts
│   └── fixtures/             # mock tool outputs for testing
│       ├── claude-mcp-list.txt
│       ├── skills-update.txt
│       └── ...
└── docs/
    ├── plan.md               # this file
    ├── adapters.md           # how to write a new adapter
    └── architecture.md
```

---

## Phased Delivery

| Phase | Tasks | Milestone |
|---|---|---|
| **A. Foundation + Claude ecosystem** | 1–9 | v0.1 alpha — works for Claude Code + plugins + skills |
| **B. Cross-agent expansion** | 10–14 | v0.2 — adds Codex, OpenClaw, Hermes |
| **C. Schedule + changelog + init** | 15–20 | v0.3 — complete feature set |
| **D. Polish + launch** | 21–24 | v1.0 — published to npm + launched |

---

# Phase A: Foundation + Claude Ecosystem

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `bin/freshkeeper.js`
- Create: `src/cli.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "freshkeeper",
  "version": "0.1.0-alpha.0",
  "description": "OpenClaw, Hermes, Claude Code, and Codex users' unified update keeper.",
  "type": "module",
  "bin": {
    "freshkeeper": "./bin/freshkeeper.js"
  },
  "files": ["bin", "dist", "README.md", "README.zh-CN.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "prepublishOnly": "npm run build && npm test"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "execa": "^9.5.0",
    "node-cron": "^3.0.3",
    "ora": "^8.1.0",
    "simple-git": "^3.27.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/node-cron": "^3.0.11",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  },
  "engines": { "node": ">=20" },
  "keywords": ["claude-code", "codex", "openclaw", "hermes", "ai-agents", "updater", "cli"],
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/<USER>/freshkeeper.git" },
  "homepage": "https://github.com/<USER>/freshkeeper"
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
dist
.DS_Store
*.log
.freshkeeper-dev/
coverage
```

- [ ] **Step 5: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 <USER>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6: Write `bin/freshkeeper.js`**

```js
#!/usr/bin/env node
import('../dist/cli.js').then((m) => m.run()).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Write minimal `src/cli.ts`**

```ts
import { Command } from 'commander';

export function run(): void {
  const program = new Command();
  program
    .name('freshkeeper')
    .description('Unified update keeper for AI coding agents')
    .version('0.1.0-alpha.0');

  program.parse(process.argv);
}
```

- [ ] **Step 8: Install deps, build, verify CLI**

Run: `npm install && npm run build && node bin/freshkeeper.js --version`
Expected stdout: `0.1.0-alpha.0`

- [ ] **Step 9: Init git + first commit**

```bash
git init
git add .
git commit -m "chore: scaffold freshkeeper project"
```

---

## Task 2: Adapter Interface + Registry

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/registry.ts`
- Create: `tests/adapters/registry.test.ts`

- [ ] **Step 1: Write failing test `tests/adapters/registry.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npm test -- tests/adapters/registry.test.ts`
Expected: FAIL with "Cannot find module" (Registry not implemented yet).

- [ ] **Step 3: Implement `src/adapters/types.ts`**

```ts
export interface DetectResult {
  installed: boolean;
  version?: string;
  installMethod?: string;
  note?: string;
}

export interface UpdateInfo {
  item: string;
  currentVersion: string;
  latestVersion: string;
  source?: string;
  changelogUrl?: string;
}

export interface UpdateResult {
  updated: string[];
  failed: Array<{ item: string; error: string }>;
  logs: string;
}

export interface Adapter {
  id: string;
  displayName: string;
  detect(): Promise<DetectResult>;
  check(): Promise<UpdateInfo[]>;
  update(): Promise<UpdateResult>;
}
```

- [ ] **Step 4: Implement `src/adapters/registry.ts`**

```ts
import type { Adapter } from './types.js';

export class Registry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  list(): Adapter[] {
    return Array.from(this.adapters.values());
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `npm test -- tests/adapters/registry.test.ts`
Expected: PASS (both tests green).

- [ ] **Step 6: Commit**

```bash
git add src/adapters tests/adapters
git commit -m "feat(adapters): add Adapter interface and Registry"
```

---

## Task 3: Shared Utilities (exec + paths + logger)

**Files:**
- Create: `src/util/exec.ts`
- Create: `src/util/paths.ts`
- Create: `src/logger.ts`
- Create: `tests/util/exec.test.ts`

- [ ] **Step 1: Write failing test `tests/util/exec.test.ts`**

```ts
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
});
```

- [ ] **Step 2: Run test — expect fail (module not found)**

Run: `npm test -- tests/util/exec.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/util/exec.ts`**

```ts
import { execa } from 'execa';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
}

export async function safeExec(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<ExecResult> {
  try {
    const r = await execa(cmd, args, { cwd: opts?.cwd, env: opts?.env, reject: false });
    return {
      ok: r.exitCode === 0,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode ?? undefined
    };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
```

- [ ] **Step 4: Implement `src/util/paths.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function freshkeeperHome(): string {
  return process.env.FRESHKEEPER_HOME ?? join(homedir(), '.freshkeeper');
}

export function configPath(): string {
  return join(freshkeeperHome(), 'config.json');
}

export function logPath(): string {
  return join(freshkeeperHome(), 'freshkeeper.log');
}
```

- [ ] **Step 5: Implement `src/logger.ts`**

```ts
import chalk from 'chalk';

export const log = {
  info: (msg: string) => console.log(chalk.cyan('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✗'), msg),
  step: (msg: string) => console.log(chalk.dim('  →'), msg)
};
```

- [ ] **Step 6: Run tests — expect pass**

Run: `npm test -- tests/util/exec.test.ts`
Expected: PASS (3/3).

- [ ] **Step 7: Commit**

```bash
git add src/util src/logger.ts tests/util
git commit -m "feat(util): add safeExec, path helpers, and logger"
```

---

## Task 4: Claude Code Adapter

**Files:**
- Create: `src/adapters/claude-code.ts`
- Create: `tests/adapters/claude-code.test.ts`
- Create: `tests/fixtures/claude-version.txt`

- [ ] **Step 1: Create fixture `tests/fixtures/claude-version.txt`**

```
2.1.116 (Claude Code)
```

- [ ] **Step 2: Write failing test `tests/adapters/claude-code.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { claudeCodeAdapter } from '../../src/adapters/claude-code.js';

describe('claude-code adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed claude with version', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '2.1.116 (Claude Code)', stderr: '' });
    const r = await claudeCodeAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('2.1.116');
  });

  it('reports not installed if `claude` binary missing', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: false, stdout: '', stderr: '', error: 'ENOENT' });
    const r = await claudeCodeAdapter.detect();
    expect(r.installed).toBe(false);
  });

  it('update runs `claude update`', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'Claude Code is up to date (2.1.116)', stderr: '' });
    const r = await claudeCodeAdapter.update();
    expect(spy).toHaveBeenCalledWith('claude', ['update']);
    expect(r.failed).toHaveLength(0);
    expect(r.logs).toContain('up to date');
  });
});
```

- [ ] **Step 3: Run test — expect fail**

Run: `npm test -- tests/adapters/claude-code.test.ts`
Expected: FAIL (adapter module missing).

- [ ] **Step 4: Implement `src/adapters/claude-code.ts`**

```ts
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  displayName: 'Claude Code CLI',

  async detect() {
    const r = await safeExec('claude', ['--version']);
    if (!r.ok) return { installed: false };
    const match = r.stdout.match(/(\d+\.\d+\.\d+)/);
    return { installed: true, version: match?.[1], installMethod: 'native' };
  },

  async check() {
    // Claude Code has a native auto-updater; we cannot query "latest" without running update.
    // Return empty — updates are applied directly.
    return [];
  },

  async update() {
    const r = await safeExec('claude', ['update']);
    return {
      updated: r.ok ? ['claude-code'] : [],
      failed: r.ok ? [] : [{ item: 'claude-code', error: r.stderr || r.error || 'unknown' }],
      logs: r.stdout + (r.stderr ? `\n${r.stderr}` : '')
    };
  }
};
```

- [ ] **Step 5: Run test — expect pass (3/3)**

Run: `npm test -- tests/adapters/claude-code.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claude-code.ts tests/adapters/claude-code.test.ts tests/fixtures/claude-version.txt
git commit -m "feat(adapters): add claude-code adapter"
```

---

## Task 5: Claude Plugins Adapter

**Files:**
- Create: `src/adapters/claude-plugins.ts`
- Create: `tests/adapters/claude-plugins.test.ts`
- Create: `tests/fixtures/claude-plugin-list.txt`

- [ ] **Step 1: Create fixture `tests/fixtures/claude-plugin-list.txt`**

```
Installed plugins:

  ❯ claude-mem@thedotmack
    Version: 12.1.5
    Scope: user
    Status: ✔ enabled

  ❯ codex@openai-codex
    Version: 1.0.4
    Scope: user
    Status: ✔ enabled
```

- [ ] **Step 2: Write failing test `tests/adapters/claude-plugins.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as exec from '../../src/util/exec.js';
import { claudePluginsAdapter, parsePluginList } from '../../src/adapters/claude-plugins.js';

const fixture = readFileSync(join(__dirname, '../fixtures/claude-plugin-list.txt'), 'utf-8');

describe('claude-plugins adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses plugin list output into objects', () => {
    const parsed = parsePluginList(fixture);
    expect(parsed).toEqual([
      { name: 'claude-mem', source: 'thedotmack', version: '12.1.5', scope: 'user' },
      { name: 'codex', source: 'openai-codex', version: '1.0.4', scope: 'user' }
    ]);
  });

  it('detect reports installed when plugins found', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: fixture, stderr: '' });
    const r = await claudePluginsAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.note).toContain('2 plugin');
  });

  it('update runs `claude plugin update` per plugin and aggregates results', async () => {
    const spy = vi.spyOn(exec, 'safeExec')
      .mockResolvedValueOnce({ ok: true, stdout: fixture, stderr: '' })                       // list
      .mockResolvedValueOnce({ ok: true, stdout: 'updated claude-mem', stderr: '' })          // update 1
      .mockResolvedValueOnce({ ok: true, stdout: 'already latest codex', stderr: '' });       // update 2
    const r = await claudePluginsAdapter.update();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(r.updated).toEqual(['claude-mem@thedotmack', 'codex@openai-codex']);
  });
});
```

- [ ] **Step 3: Run — expect fail**

Run: `npm test -- tests/adapters/claude-plugins.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/adapters/claude-plugins.ts`**

```ts
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export interface PluginInfo {
  name: string;
  source: string;
  version: string;
  scope: string;
}

export function parsePluginList(stdout: string): PluginInfo[] {
  const plugins: PluginInfo[] = [];
  const blocks = stdout.split(/❯\s+/).slice(1);
  for (const block of blocks) {
    const header = block.split('\n')[0].trim();
    const [name, source] = header.split('@');
    const version = block.match(/Version:\s*([^\s]+)/)?.[1] ?? 'unknown';
    const scope = block.match(/Scope:\s*([^\s]+)/)?.[1] ?? 'user';
    if (name && source) plugins.push({ name, source, version, scope });
  }
  return plugins;
}

export const claudePluginsAdapter: Adapter = {
  id: 'claude-plugins',
  displayName: 'Claude Code Plugins',

  async detect() {
    const r = await safeExec('claude', ['plugin', 'list']);
    if (!r.ok) return { installed: false };
    const plugins = parsePluginList(r.stdout);
    return { installed: plugins.length > 0, note: `${plugins.length} plugin(s)` };
  },

  async check() {
    // `claude plugin update` has no dry-run; return empty — updates applied directly.
    return [];
  },

  async update() {
    const list = await safeExec('claude', ['plugin', 'list']);
    if (!list.ok) return { updated: [], failed: [{ item: 'plugin-list', error: list.stderr || 'list failed' }], logs: list.stderr };

    const plugins = parsePluginList(list.stdout);
    const updated: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];
    const logs: string[] = [];

    for (const p of plugins) {
      const id = `${p.name}@${p.source}`;
      const r = await safeExec('claude', ['plugin', 'update', id]);
      logs.push(`[${id}] ${r.stdout.trim()}`);
      if (r.ok) updated.push(id);
      else failed.push({ item: id, error: r.stderr || 'update failed' });
    }
    return { updated, failed, logs: logs.join('\n') };
  }
};
```

- [ ] **Step 5: Run — expect pass (3/3)**

Run: `npm test -- tests/adapters/claude-plugins.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claude-plugins.ts tests/adapters/claude-plugins.test.ts tests/fixtures/claude-plugin-list.txt
git commit -m "feat(adapters): add claude-plugins adapter"
```

---

## Task 6: Skills CLI Adapter

**Files:**
- Create: `src/adapters/skills-cli.ts`
- Create: `tests/adapters/skills-cli.test.ts`

- [ ] **Step 1: Write failing test `tests/adapters/skills-cli.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { skillsCliAdapter } from '../../src/adapters/skills-cli.js';

describe('skills-cli adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects via `npx skills --version`', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '1.5.1', stderr: '' });
    const r = await skillsCliAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('1.5.1');
  });

  it('update runs `npx skills update -y` in cwd', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();
    expect(spy).toHaveBeenCalledWith('npx', ['skills', 'update', '-y'], expect.any(Object));
    expect(r.updated.length).toBeGreaterThan(0);
  });

  it('parses skill count from output', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: '✓ Updated 18 skill(s)', stderr: '' });
    const r = await skillsCliAdapter.update();
    expect(r.logs).toContain('18');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/adapters/skills-cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/skills-cli.ts`**

```ts
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
    return []; // skills update does not expose a dry-run
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
```

- [ ] **Step 4: Run — expect pass (3/3)**

Run: `npm test -- tests/adapters/skills-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/skills-cli.ts tests/adapters/skills-cli.test.ts
git commit -m "feat(adapters): add skills-cli adapter"
```

---

## Task 7: `list` Command

**Files:**
- Create: `src/commands/list.ts`
- Create: `tests/commands/list.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test `tests/commands/list.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { runList } from '../../src/commands/list.js';
import type { Adapter } from '../../src/adapters/types.js';

const makeAdapter = (id: string, installed: boolean, version?: string): Adapter => ({
  id,
  displayName: id,
  async detect() { return { installed, version }; },
  async check() { return []; },
  async update() { return { updated: [], failed: [], logs: '' }; }
});

describe('list command', () => {
  it('returns rows with detection results for each adapter', async () => {
    const r = new Registry();
    r.register(makeAdapter('a', true, '1.0'));
    r.register(makeAdapter('b', false));
    const rows = await runList(r);
    expect(rows).toEqual([
      { id: 'a', installed: true, version: '1.0' },
      { id: 'b', installed: false, version: undefined }
    ]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/commands/list.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/list.ts`**

```ts
import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';

export interface ListRow {
  id: string;
  installed: boolean;
  version?: string;
}

export async function runList(registry: Registry): Promise<ListRow[]> {
  const rows: ListRow[] = [];
  for (const a of registry.list()) {
    const det = await a.detect();
    rows.push({ id: a.id, installed: det.installed, version: det.version });
  }
  return rows;
}

export async function printList(registry: Registry): Promise<void> {
  const rows = await runList(registry);
  for (const r of rows) {
    if (r.installed) log.success(`${r.id.padEnd(20)} ${r.version ?? ''}`);
    else log.warn(`${r.id.padEnd(20)} (not installed)`);
  }
}
```

- [ ] **Step 4: Wire command in `src/cli.ts`**

Replace `src/cli.ts` with:

```ts
import { Command } from 'commander';
import { Registry } from './adapters/registry.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { claudePluginsAdapter } from './adapters/claude-plugins.js';
import { skillsCliAdapter } from './adapters/skills-cli.js';
import { printList } from './commands/list.js';

function buildRegistry(): Registry {
  const r = new Registry();
  r.register(claudeCodeAdapter);
  r.register(claudePluginsAdapter);
  r.register(skillsCliAdapter);
  return r;
}

export function run(): void {
  const program = new Command();
  program
    .name('freshkeeper')
    .description('Unified update keeper for AI coding agents')
    .version('0.1.0-alpha.0');

  program
    .command('list')
    .description('Show which supported agents are installed')
    .action(async () => {
      const r = buildRegistry();
      await printList(r);
    });

  program.parse(process.argv);
}
```

- [ ] **Step 5: Run — expect pass**

Run: `npm test && npm run build && node bin/freshkeeper.js list`
Expected: PASS on tests; `list` prints rows for claude-code, claude-plugins, skills-cli on your machine.

- [ ] **Step 6: Commit**

```bash
git add src/commands src/cli.ts tests/commands
git commit -m "feat(cli): add list command"
```

---

## Task 8: `check` Command

**Files:**
- Create: `src/commands/check.ts`
- Create: `tests/commands/check.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test `tests/commands/check.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { runCheck } from '../../src/commands/check.js';
import type { Adapter } from '../../src/adapters/types.js';

const mkAdapter = (id: string, updates: any[]): Adapter => ({
  id,
  displayName: id,
  async detect() { return { installed: true, version: '1' }; },
  async check() { return updates; },
  async update() { return { updated: [], failed: [], logs: '' }; }
});

describe('check command', () => {
  it('aggregates updates across adapters', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [{ item: 'pkg-1', currentVersion: '1.0', latestVersion: '1.1' }]));
    r.register(mkAdapter('b', []));
    const results = await runCheck(r);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ adapter: 'a', item: 'pkg-1' });
  });

  it('skips not-installed adapters', async () => {
    const r = new Registry();
    r.register({
      id: 'gone', displayName: 'g',
      async detect() { return { installed: false }; },
      async check() { throw new Error('should not be called'); },
      async update() { return { updated: [], failed: [], logs: '' }; }
    });
    const results = await runCheck(r);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/commands/check.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/check.ts`**

```ts
import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { UpdateInfo } from '../adapters/types.js';

export interface CheckRow extends UpdateInfo {
  adapter: string;
}

export async function runCheck(registry: Registry): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const a of registry.list()) {
    const det = await a.detect();
    if (!det.installed) continue;
    const updates = await a.check();
    for (const u of updates) rows.push({ adapter: a.id, ...u });
  }
  return rows;
}

export async function printCheck(registry: Registry): Promise<void> {
  const rows = await runCheck(registry);
  if (rows.length === 0) {
    log.success('No pending updates detected via dry-run (some adapters only expose changes after `update`).');
    return;
  }
  log.info(`${rows.length} update(s) available:`);
  for (const r of rows) {
    log.step(`[${r.adapter}] ${r.item}: ${r.currentVersion} → ${r.latestVersion}`);
  }
}
```

- [ ] **Step 4: Wire `check` command in `src/cli.ts`**

Inside `run()`, after the `list` command block, add:

```ts
  program
    .command('check')
    .description('Show pending updates across installed agents')
    .action(async () => {
      const r = buildRegistry();
      await printCheck(r);
    });
```

And add `import { printCheck } from './commands/check.js';` at top.

- [ ] **Step 5: Run tests + smoke test CLI**

Run: `npm test && npm run build && node bin/freshkeeper.js check`
Expected: PASS; CLI prints message (may report "No pending updates" if all up to date).

- [ ] **Step 6: Commit**

```bash
git add src/commands/check.ts src/cli.ts tests/commands/check.test.ts
git commit -m "feat(cli): add check command"
```

---

## Task 9: `update` Command

**Files:**
- Create: `src/commands/update.ts`
- Create: `tests/commands/update.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test `tests/commands/update.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/adapters/registry.js';
import { runUpdate } from '../../src/commands/update.js';
import type { Adapter } from '../../src/adapters/types.js';

const mkAdapter = (id: string, updated: string[], failed: any[] = []): Adapter => ({
  id, displayName: id,
  async detect() { return { installed: true }; },
  async check() { return []; },
  async update() { return { updated, failed, logs: `log-of-${id}` }; }
});

describe('update command', () => {
  it('runs update across all installed adapters and aggregates', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', ['a1']));
    r.register(mkAdapter('b', ['b1', 'b2']));
    const report = await runUpdate(r);
    expect(report.totalUpdated).toBe(3);
    expect(report.perAdapter).toHaveLength(2);
  });

  it('captures failures without throwing', async () => {
    const r = new Registry();
    r.register(mkAdapter('a', [], [{ item: 'x', error: 'boom' }]));
    const report = await runUpdate(r);
    expect(report.totalFailed).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/commands/update.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/update.ts`**

```ts
import ora from 'ora';
import { log } from '../logger.js';
import type { Registry } from '../adapters/registry.js';
import type { UpdateResult } from '../adapters/types.js';

export interface UpdateReport {
  perAdapter: Array<{ id: string; result: UpdateResult }>;
  totalUpdated: number;
  totalFailed: number;
}

export async function runUpdate(registry: Registry): Promise<UpdateReport> {
  const perAdapter: UpdateReport['perAdapter'] = [];
  for (const a of registry.list()) {
    const det = await a.detect();
    if (!det.installed) continue;
    const result = await a.update();
    perAdapter.push({ id: a.id, result });
  }
  return {
    perAdapter,
    totalUpdated: perAdapter.reduce((s, x) => s + x.result.updated.length, 0),
    totalFailed: perAdapter.reduce((s, x) => s + x.result.failed.length, 0)
  };
}

export async function printUpdate(registry: Registry): Promise<void> {
  const spinner = ora('Updating all installed agents...').start();
  const report = await runUpdate(registry);
  spinner.stop();
  for (const { id, result } of report.perAdapter) {
    if (result.updated.length) log.success(`${id}: updated ${result.updated.join(', ')}`);
    else log.info(`${id}: no changes`);
    for (const f of result.failed) log.error(`${id}: failed ${f.item} — ${f.error}`);
  }
  log.info(`Done. ${report.totalUpdated} updated, ${report.totalFailed} failed.`);
}
```

- [ ] **Step 4: Wire in `src/cli.ts`** — add:

```ts
  program
    .command('update')
    .description('Update all installed agents (CLI + plugins + skills)')
    .action(async () => {
      const r = buildRegistry();
      await printUpdate(r);
    });
```

(and `import { printUpdate } from './commands/update.js';` at top)

- [ ] **Step 5: Run tests + smoke test**

Run: `npm test && npm run build && node bin/freshkeeper.js update`
Expected: PASS; CLI successfully runs updates on your machine (same as last week's script).

- [ ] **Step 6: Commit + tag v0.1.0-alpha.0**

```bash
git add src/commands/update.ts src/cli.ts tests/commands/update.test.ts
git commit -m "feat(cli): add update command"
git tag v0.1.0-alpha.0
```

**🎉 Phase A complete — v0.1 alpha: works end-to-end for Claude Code + plugins + skills.**

---

# Phase B: Cross-Agent Expansion

## Task 10: Research OpenClaw & Hermes Update Mechanisms

**Files:**
- Create: `docs/research/openclaw-update.md`
- Create: `docs/research/hermes-update.md`

- [ ] **Step 1: Dispatch research subagent (Explore agent)**

Prompt for the agent:

> Research how OpenClaw (https://github.com/openclaw/openclaw) and Hermes Agent (https://github.com/nousresearch/hermes-agent) handle updates. For each, answer:
> 1. How is it installed (npm, curl script, homebrew, git clone)?
> 2. What command updates the CLI itself? Is there a built-in `update` command?
> 3. Does it have a skill / plugin system? How are those updated?
> 4. Is there a version command?
> 5. Write results to `docs/research/openclaw-update.md` and `docs/research/hermes-update.md` — include actual command strings, example outputs if available, and a proposed adapter shape.

- [ ] **Step 2: Review the research docs**

Read both files. Confirm:
- Install/update commands are concrete
- Version-detection command is known
- Any gotchas are noted

If anything is ambiguous, re-dispatch with specific follow-ups.

- [ ] **Step 3: Commit research**

```bash
git add docs/research
git commit -m "docs: research OpenClaw and Hermes update mechanisms"
```

---

## Task 11: Codex Adapter

**Files:**
- Create: `src/adapters/codex.ts`
- Create: `tests/adapters/codex.test.ts`

- [ ] **Step 1: Write failing test `tests/adapters/codex.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { codexAdapter } from '../../src/adapters/codex.js';

describe('codex adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed codex', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'codex 1.0.4', stderr: '' });
    const r = await codexAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('1.0.4');
  });

  it('update defers to Claude plugin flow since Codex is installed as Claude plugin', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'updated codex', stderr: '' });
    const r = await codexAdapter.update();
    expect(r.updated).toContain('codex');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/adapters/codex.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/codex.ts`**

```ts
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const codexAdapter: Adapter = {
  id: 'codex',
  displayName: 'OpenAI Codex CLI',

  async detect() {
    const r = await safeExec('codex', ['--version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    return { installed: true, version };
  },

  async check() {
    return [];
  },

  async update() {
    // Codex is distributed as a Claude plugin (codex@openai-codex);
    // delegate to `claude plugin update codex@openai-codex` for parity.
    const r = await safeExec('claude', ['plugin', 'update', 'codex@openai-codex']);
    return {
      updated: r.ok ? ['codex'] : [],
      failed: r.ok ? [] : [{ item: 'codex', error: r.stderr || 'update failed' }],
      logs: r.stdout
    };
  }
};
```

> **NOTE:** If research in Task 10 shows Codex CLI has its own standalone updater (e.g. `codex update`), replace the update body with that command and adjust the test.

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/adapters/codex.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in `src/cli.ts`**

In `buildRegistry()`, add:

```ts
  r.register(codexAdapter);
```

And add the import at the top.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/codex.ts src/cli.ts tests/adapters/codex.test.ts
git commit -m "feat(adapters): add codex adapter"
```

---

## Task 12: OpenClaw Adapter

**Files:**
- Create: `src/adapters/openclaw.ts`
- Create: `tests/adapters/openclaw.test.ts`

> **Prerequisite:** Task 10 research must be complete. The following test + implementation assume `openclaw --version` works and updates are done via `openclaw update` — **adjust based on Task 10 findings**.

- [ ] **Step 1: Write failing test `tests/adapters/openclaw.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { openClawAdapter } from '../../src/adapters/openclaw.js';

describe('openclaw adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed openclaw', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'openclaw 0.8.2', stderr: '' });
    const r = await openClawAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('0.8.2');
  });

  it('update runs `openclaw update`', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'openclaw updated', stderr: '' });
    const r = await openClawAdapter.update();
    expect(spy).toHaveBeenCalledWith('openclaw', ['update']);
    expect(r.updated).toContain('openclaw');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/adapters/openclaw.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/openclaw.ts`**

```ts
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const openClawAdapter: Adapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',

  async detect() {
    const r = await safeExec('openclaw', ['--version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    return { installed: true, version };
  },

  async check() {
    return [];
  },

  async update() {
    const r = await safeExec('openclaw', ['update']);
    return {
      updated: r.ok ? ['openclaw'] : [],
      failed: r.ok ? [] : [{ item: 'openclaw', error: r.stderr || 'update failed' }],
      logs: r.stdout
    };
  }
};
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/adapters/openclaw.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in `src/cli.ts` + commit**

```ts
  r.register(openClawAdapter);
```

```bash
git add src/adapters/openclaw.ts src/cli.ts tests/adapters/openclaw.test.ts
git commit -m "feat(adapters): add openclaw adapter"
```

---

## Task 13: Hermes Adapter

**Files:**
- Create: `src/adapters/hermes.ts`
- Create: `tests/adapters/hermes.test.ts`

> Same pattern as Task 12. Adjust commands based on Task 10 findings for Hermes.

- [ ] **Step 1: Write failing test (mirrors Task 12 structure, replacing `openclaw` → `hermes`)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exec from '../../src/util/exec.js';
import { hermesAdapter } from '../../src/adapters/hermes.js';

describe('hermes adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('detects installed hermes', async () => {
    vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'hermes 0.4.1', stderr: '' });
    const r = await hermesAdapter.detect();
    expect(r.installed).toBe(true);
    expect(r.version).toBe('0.4.1');
  });

  it('update runs `hermes update`', async () => {
    const spy = vi.spyOn(exec, 'safeExec').mockResolvedValue({ ok: true, stdout: 'hermes updated', stderr: '' });
    const r = await hermesAdapter.update();
    expect(spy).toHaveBeenCalledWith('hermes', ['update']);
    expect(r.updated).toContain('hermes');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/adapters/hermes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/hermes.ts`**

```ts
import { safeExec } from '../util/exec.js';
import type { Adapter } from './types.js';

export const hermesAdapter: Adapter = {
  id: 'hermes',
  displayName: 'Hermes Agent',

  async detect() {
    const r = await safeExec('hermes', ['--version']);
    if (!r.ok) return { installed: false };
    const version = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    return { installed: true, version };
  },

  async check() {
    return [];
  },

  async update() {
    const r = await safeExec('hermes', ['update']);
    return {
      updated: r.ok ? ['hermes'] : [],
      failed: r.ok ? [] : [{ item: 'hermes', error: r.stderr || 'update failed' }],
      logs: r.stdout
    };
  }
};
```

- [ ] **Step 4: Run — expect pass; register in CLI; commit**

```bash
npm test -- tests/adapters/hermes.test.ts
# (add `r.register(hermesAdapter);` + import in src/cli.ts)
git add src/adapters/hermes.ts src/cli.ts tests/adapters/hermes.test.ts
git commit -m "feat(adapters): add hermes adapter"
git tag v0.2.0-alpha.0
```

**🎉 Phase B complete — v0.2: all 4 target agents covered.**

---

# Phase C: Schedule + Changelog + Init

## Task 14: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing test `tests/config.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, defaultConfig } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fk-'));
  process.env.FRESHKEEPER_HOME = dir;
});

describe('config', () => {
  it('returns defaults when file missing', () => {
    const cfg = loadConfig();
    expect(cfg).toEqual(defaultConfig());
  });

  it('loads written config', () => {
    const written = { ...defaultConfig(), enabledAdapters: ['claude-code'] };
    saveConfig(written);
    expect(loadConfig()).toEqual(written);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { configPath, freshkeeperHome } from './util/paths.js';

export interface Config {
  enabledAdapters: string[];
  schedule: { enabled: boolean; cron: string } | null;
  notify: { enabled: boolean; macNotification: boolean };
}

export function defaultConfig(): Config {
  return {
    enabledAdapters: ['claude-code', 'claude-plugins', 'skills-cli', 'codex', 'openclaw', 'hermes'],
    schedule: null,
    notify: { enabled: true, macNotification: false }
  };
}

export function loadConfig(): Config {
  const p = configPath();
  if (!existsSync(p)) return defaultConfig();
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function saveConfig(cfg: Config): void {
  mkdirSync(freshkeeperHome(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loader"
```

---

## Task 15: Changelog Fetcher (GitHub Releases)

**Files:**
- Create: `src/changelog/github.ts`
- Create: `tests/changelog/github.test.ts`

- [ ] **Step 1: Write failing test `tests/changelog/github.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchReleaseNotes } from '../../src/changelog/github.js';

describe('fetchReleaseNotes', () => {
  it('fetches latest release body from GitHub API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.2.3', body: 'release notes here', html_url: 'https://x' })
    } as any);

    const r = await fetchReleaseNotes('owner/repo');
    expect(r).toEqual({ tag: 'v1.2.3', body: 'release notes here', url: 'https://x' });
  });

  it('returns null on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as any);
    expect(await fetchReleaseNotes('owner/missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/changelog/github.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/changelog/github.ts`**

```ts
export interface ReleaseNote {
  tag: string;
  body: string;
  url: string;
}

export async function fetchReleaseNotes(repo: string): Promise<ReleaseNote | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  const data = await r.json() as { tag_name: string; body: string; html_url: string };
  return { tag: data.tag_name, body: data.body, url: data.html_url };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/changelog/github.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/changelog tests/changelog
git commit -m "feat(changelog): fetch GitHub release notes"
```

---

## Task 16: Changelog Aggregation into Update Report

**Files:**
- Modify: `src/commands/update.ts` — augment report with changelog
- Create: `src/changelog/aggregate.ts`
- Create: `tests/changelog/aggregate.test.ts`

- [ ] **Step 1: Write failing test `tests/changelog/aggregate.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { aggregateChangelog } from '../../src/changelog/aggregate.js';

describe('aggregateChangelog', () => {
  it('fetches release notes for each adapter with a known repo', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1', body: 'body', html_url: 'https://x' })
    } as any);
    const r = await aggregateChangelog([
      { id: 'claude-code', repo: 'anthropics/claude-code' },
      { id: 'unknown', repo: undefined }
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].adapter).toBe('claude-code');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/changelog/aggregate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/changelog/aggregate.ts`**

```ts
import { fetchReleaseNotes } from './github.js';

export interface AdapterRepo { id: string; repo?: string; }
export interface ChangelogEntry { adapter: string; tag: string; body: string; url: string; }

export const ADAPTER_REPOS: Record<string, string> = {
  'claude-code': 'anthropics/claude-code',
  'openclaw': 'openclaw/openclaw',
  'hermes': 'nousresearch/hermes-agent',
  'codex': 'openai/codex'
};

export async function aggregateChangelog(adapters: AdapterRepo[]): Promise<ChangelogEntry[]> {
  const out: ChangelogEntry[] = [];
  for (const { id, repo } of adapters) {
    if (!repo) continue;
    const n = await fetchReleaseNotes(repo);
    if (n) out.push({ adapter: id, tag: n.tag, body: n.body, url: n.url });
  }
  return out;
}
```

- [ ] **Step 4: Integrate into `printUpdate` in `src/commands/update.ts`**

At the end of `printUpdate`, after the existing summary, add:

```ts
  const { aggregateChangelog, ADAPTER_REPOS } = await import('../changelog/aggregate.js');
  const entries = await aggregateChangelog(
    report.perAdapter
      .filter(x => x.result.updated.length > 0)
      .map(x => ({ id: x.id, repo: ADAPTER_REPOS[x.id] }))
  );
  if (entries.length) {
    console.log('\n--- Changelogs ---');
    for (const e of entries) {
      console.log(`\n[${e.adapter}] ${e.tag}`);
      console.log(e.body.slice(0, 500));
      console.log(`→ ${e.url}`);
    }
  }
```

- [ ] **Step 5: Run — expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/changelog/aggregate.ts src/commands/update.ts tests/changelog/aggregate.test.ts
git commit -m "feat(update): aggregate changelog for updated adapters"
```

---

## Task 17: Scheduler — Crontab Setup

**Files:**
- Create: `src/scheduler/crontab.ts`
- Create: `tests/scheduler/crontab.test.ts`

- [ ] **Step 1: Write failing test `tests/scheduler/crontab.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { renderCrontabLine, markerBegin, markerEnd, injectIntoCrontab } from '../../src/scheduler/crontab.js';

describe('crontab rendering', () => {
  it('renders line with cron expression and freshkeeper update command', () => {
    const line = renderCrontabLine('0 10 * * 1');
    expect(line).toMatch(/^0 10 \* \* 1\s+.+freshkeeper update/);
  });

  it('wraps content in managed block when injecting', () => {
    const existing = 'existing\n';
    const newTab = injectIntoCrontab(existing, '0 10 * * 1');
    expect(newTab).toContain(markerBegin);
    expect(newTab).toContain(markerEnd);
    expect(newTab).toContain('existing');
  });

  it('replaces existing managed block on re-inject', () => {
    const existing = `${markerBegin}\n0 9 * * * old\n${markerEnd}\nother\n`;
    const newTab = injectIntoCrontab(existing, '0 10 * * 1');
    expect(newTab).not.toContain('old');
    expect(newTab).toContain('other');
    expect((newTab.match(new RegExp(markerBegin, 'g')) || []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- tests/scheduler/crontab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/scheduler/crontab.ts`**

```ts
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
```

- [ ] **Step 4: Run — expect pass (3/3)**

Run: `npm test -- tests/scheduler/crontab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/crontab.ts tests/scheduler/crontab.test.ts
git commit -m "feat(scheduler): crontab install/uninstall with managed block"
```

---

## Task 18: `schedule` Command

**Files:**
- Create: `src/commands/schedule.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement `src/commands/schedule.ts`**

```ts
import { installCrontab, uninstallCrontab } from '../scheduler/crontab.js';
import { loadConfig, saveConfig } from '../config.js';
import { log } from '../logger.js';

export async function runSchedule(cron: string | 'off'): Promise<void> {
  const cfg = loadConfig();
  if (cron === 'off') {
    await uninstallCrontab();
    cfg.schedule = null;
    saveConfig(cfg);
    log.success('Schedule removed.');
    return;
  }
  await installCrontab(cron);
  cfg.schedule = { enabled: true, cron };
  saveConfig(cfg);
  log.success(`Schedule set: ${cron}`);
}
```

- [ ] **Step 2: Wire command in `src/cli.ts`** — add:

```ts
  program
    .command('schedule <cron>')
    .description('Install a crontab entry. Use "off" to remove. Example: "0 10 * * 1"')
    .action(async (cron: string) => {
      await runSchedule(cron);
    });
```

And `import { runSchedule } from './commands/schedule.js';`.

- [ ] **Step 3: Smoke test**

Run: `npm run build && node bin/freshkeeper.js schedule "0 10 * * 1" && crontab -l`
Expected: your crontab now contains a `freshkeeper` managed block.

Then: `node bin/freshkeeper.js schedule off && crontab -l`
Expected: block is removed.

- [ ] **Step 4: Commit**

```bash
git add src/commands/schedule.ts src/cli.ts
git commit -m "feat(cli): add schedule command"
```

---

## Task 19: `init` Command (Interactive Setup)

**Files:**
- Create: `src/commands/init.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement `src/commands/init.ts`**

```ts
import readline from 'node:readline/promises';
import { Registry } from '../adapters/registry.js';
import { printList } from './list.js';
import { runUpdate, printUpdate } from './update.js';
import { runSchedule } from './schedule.js';
import { log } from '../logger.js';

export async function runInit(registry: Registry): Promise<void> {
  log.info('Welcome to Freshkeeper. Detecting installed agents...');
  await printList(registry);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const runNow = (await rl.question('\nRun an update right now? [Y/n] ')).trim().toLowerCase();
  if (runNow !== 'n') await printUpdate(registry);

  const schedule = (await rl.question('\nSet a weekly auto-update (Monday 10:00)? [Y/n] ')).trim().toLowerCase();
  if (schedule !== 'n') await runSchedule('0 10 * * 1');

  rl.close();
  log.success('Freshkeeper is set up. Run `freshkeeper update` anytime, or let the schedule handle it.');
}
```

- [ ] **Step 2: Wire in `src/cli.ts`** — add:

```ts
  program
    .command('init')
    .description('Interactive setup: detect agents, run first update, install schedule')
    .action(async () => {
      const r = buildRegistry();
      await runInit(r);
    });
```

And `import { runInit } from './commands/init.js';`.

- [ ] **Step 3: Smoke test**

Run: `npm run build && node bin/freshkeeper.js init`
Expected: walks through detection → update → schedule prompts.

- [ ] **Step 4: Commit + tag v0.3.0**

```bash
git add src/commands/init.ts src/cli.ts
git commit -m "feat(cli): add init command"
git tag v0.3.0
```

**🎉 Phase C complete — v0.3: full feature set (list / check / update / schedule / init).**

---

# Phase D: Polish + Launch

## Task 20: README (EN + zh-CN)

**Files:**
- Create: `README.md`
- Create: `README.zh-CN.md`

- [ ] **Step 1: Write `README.md`**

Structure:
- Badges: npm version, CI status, MIT license
- One-line pitch: "The unified update keeper for OpenClaw, Hermes, Claude Code, and Codex users."
- 30-second demo (asciinema GIF or screenshot of `freshkeeper init`)
- Install: `npx freshkeeper@latest init`
- Commands table (list / check / update / schedule / init)
- Supported adapters table (tool / install method / what gets updated)
- Config file location + schema
- FAQ: "Does this replace `claude plugin update`?" "Is this safe to run automatically?"
- Contributing: how to add a new adapter (link to `docs/adapters.md`)
- License: MIT

- [ ] **Step 2: Write `README.zh-CN.md`** — Chinese translation of same sections. Lead with 小白-friendly tone since that's the target segment. Example opening:

> **Freshkeeper 是什么？** 一条命令，同时更新你电脑上所有 AI coding agent（OpenClaw、Hermes、Claude Code、Codex），定时跑、更新完告诉你每个工具改了什么。

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: add English and Chinese README"
```

---

## Task 21: CI Workflow (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Write `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: add CI and release workflows"
```

---

## Task 22: End-to-End Smoke Test on Author's Machine

- [ ] **Step 1: Install as if an external user**

```bash
npm pack
npm install -g ./freshkeeper-0.3.0.tgz
freshkeeper --version   # expect 0.3.0
```

- [ ] **Step 2: Run `freshkeeper init` on a clean shell**

Verify:
- Detects Claude Code, plugins, skills-cli on this machine
- Runs update successfully
- Installs crontab entry
- All output is readable + free of stack traces

- [ ] **Step 3: Run `crontab -l` + inspect**

Verify the `freshkeeper` managed block is present and will run weekly.

- [ ] **Step 4: Uninstall test**

```bash
freshkeeper schedule off
npm uninstall -g freshkeeper
```

- [ ] **Step 5: If anything failed, file issues and fix. Commit fixes.**

---

## Task 23: Publish v1.0.0 to npm + GitHub

- [ ] **Step 1: Create GitHub repo + push**

```bash
gh repo create freshkeeper --public --source=. --remote=origin --push
```

- [ ] **Step 2: Bump to 1.0.0 + tag**

```bash
npm version 1.0.0
git push origin main --tags
```

- [ ] **Step 3: Watch GitHub Actions release workflow succeed**

```bash
gh run watch
```

Expected: npm publish succeeds; GitHub Release auto-generated with notes.

- [ ] **Step 4: Verify public install**

```bash
cd /tmp && npx freshkeeper@latest --version
```

Expected: `1.0.0`.

---

## Task 24: Launch + Distribution

- [ ] **Step 1: Write 小红书 post draft `docs/launch/xiaohongshu.md`**

Title template: `我用一条命令搞定了 Claude Code / OpenClaw / Hermes 的全部更新 🦞`

Structure: problem (装了一堆工具记不住更新) → solution (Freshkeeper 一条命令) → how to install → screenshot of `init` flow → GitHub link.

- [ ] **Step 2: Write X/Twitter thread `docs/launch/x-thread.md`**

5-7 tweets. Tag `@nousresearch`, `@openclaw`, `@AnthropicAI`, `@alchaincyf`.

- [ ] **Step 3: Open PRs to awesome-* lists**

- PR to [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) — add Freshkeeper under "CLI tools" / "Utilities"
- PR to [jeremylongshore/claude-code-plugins-plus-skills](https://github.com/jeremylongshore/claude-code-plugins-plus-skills) if topically relevant
- PR to [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)

- [ ] **Step 4: Post to:**

- Claude Code Discord `#showcase`
- r/ClaudeAI subreddit
- Hacker News Show HN (evening PT for best visibility)

- [ ] **Step 5: Monitor + respond**

Watch GitHub issues + npm download stats for the first 72 hours. Respond to feedback within the day. File follow-up issues for v1.1.

---

# Post-v1.0 Backlog (Not in Plan)

- Cursor / Windsurf extension update adapters
- Aider adapter
- Gemini CLI adapter
- Windows support (via Task Scheduler instead of cron/launchd)
- macOS launchd plist as alternative to crontab
- Native macOS notification on update complete
- `freshkeeper why <adapter>` — explain what an adapter does
- Auto-update `freshkeeper` itself
- Locale support for Japanese / Korean README
