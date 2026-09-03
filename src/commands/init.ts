import readline from 'node:readline/promises';
import { buildRegistry } from '../adapters/catalog.js';
import {
  configForSelections,
  loadConfig,
  saveConfig,
  type AgentTarget,
  type MemoryProvider
} from '../config.js';
import { printList } from './list.js';
import { printUpdate } from './update.js';
import { runSchedule } from './schedule.js';
import { log } from '../logger.js';

const AGENT_CHOICES: Record<string, AgentTarget> = {
  '1': 'codex',
  '2': 'claude',
  '3': 'openclaw',
  '4': 'hermes',
  codex: 'codex',
  claude: 'claude',
  'claude-code': 'claude',
  openclaw: 'openclaw',
  hermes: 'hermes'
};

export interface InitOptions {
  primaryAgent?: AgentTarget;
  memoryProvider?: MemoryProvider;
}

async function promptPrimaryAgent(rl: readline.Interface): Promise<AgentTarget> {
  while (true) {
    const answer = (await rl.question(
      '\nWhich agent should Freshkeeper manage?\n'
      + '  1) OpenAI Codex\n'
      + '  2) Claude Code\n'
      + '  3) OpenClaw\n'
      + '  4) Hermes\n'
      + 'Choose one: '
    )).trim().toLowerCase();
    const selected = AGENT_CHOICES[answer];
    if (selected) return selected;
    log.warn('Choose 1-4 or enter codex, claude, openclaw, or hermes.');
  }
}

async function promptMemoryProvider(rl: readline.Interface): Promise<MemoryProvider> {
  const choices: Record<string, MemoryProvider> = {
    '1': 'codex',
    '2': 'claude',
    '3': 'gemini',
    '4': 'openrouter',
    codex: 'codex',
    claude: 'claude',
    gemini: 'gemini',
    openrouter: 'openrouter'
  };
  while (true) {
    const answer = (await rl.question(
      '\nWhich provider should generate claude-mem observations?\n'
      + '  1) Codex OAuth (no separate API key; uses ChatGPT/Codex plan quota)\n'
      + '  2) Claude subscription OAuth (uses Claude plan quota; API-key mode is separately billed)\n'
      + '  3) Gemini API (requires your API key; provider billing or free-tier limits apply)\n'
      + '  4) OpenRouter API (requires your API key and credits, unless using a free model)\n'
      + 'Choose one: '
    )).trim().toLowerCase();
    const selected = choices[answer];
    if (selected) return selected;
    log.warn('Choose 1-4 or enter codex, claude, gemini, or openrouter. API providers require separate credentials and may be billed separately.');
  }
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const primaryAgent = options.primaryAgent ?? await promptPrimaryAgent(rl);
  const managesClaudeMem = primaryAgent === 'codex' || primaryAgent === 'claude';
  const memoryProvider = managesClaudeMem
    ? options.memoryProvider ?? await promptMemoryProvider(rl)
    : null;
  const config = configForSelections({ primaryAgent, memoryProvider }, loadConfig());
  saveConfig(config);
  const registry = buildRegistry(config.enabledAdapters);

  log.info('Welcome to Freshkeeper. Detecting installed agents...');
  await printList(registry, primaryAgent);

  const runNow = (await rl.question('\nRun an update right now? [Y/n] ')).trim().toLowerCase();
  if (runNow !== 'n') await printUpdate(registry, { primaryAgent, memoryProvider: config.memoryProvider });

  const schedule = (await rl.question('\nSet a weekly auto-update (Monday 10:00)? [Y/n] ')).trim().toLowerCase();
  if (schedule !== 'n') await runSchedule('0 10 * * 1');

  rl.close();
  log.success('Freshkeeper is set up. Run `freshkeeper update` anytime, or let the schedule handle it.');
}
