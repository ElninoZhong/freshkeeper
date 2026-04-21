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
