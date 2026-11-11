import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { safeExec } from './update-process.mjs';

const cachePath = (dir, url) => join(dir, createHash('sha256').update(url).digest('hex') + '.json');
export async function cachedResponse(dir, url) {
  try {
    const saved = JSON.parse(await readFile(cachePath(dir, url), 'utf8'));
    if (saved.url !== url) throw new Error('Cached source URL mismatch');
    return saved;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function saveResponse(dir, url, status, bytes, contentType = 'application/json') {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = cachePath(dir, url), temp = file + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify({ url, status, contentType, body: bytes.toString('base64') }), { mode: 0o600 });
  await rename(temp, file);
}

// Loaded only for an explicitly requested update job, never an ordinary check.
if (process.env.FRESHKEEPER_UPDATE_CAPTURE_DIR) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const response = await original(input, options);
    await saveResponse(process.env.FRESHKEEPER_UPDATE_CAPTURE_DIR, String(input), response.status,
      Buffer.from(await response.clone().arrayBuffer()), response.headers.get('content-type') ?? 'application/json');
    return response;
  };
}

export function updateClient({ cacheDir, fixture = null, deadline }) {
  let token;
  const pending = new Map();
  async function fetchBuffer(url, refresh = false) {
    if (Date.now() >= deadline) throw new Error('Update time budget exceeded');
    const mock = fixture?.$updateRequests?.[url];
    if (mock) {
      if (mock.status && mock.status !== 200) throw new Error(`Upstream HTTP ${mock.status}`);
      return Buffer.from(mock.base64 ?? JSON.stringify(mock.json), mock.base64 ? 'base64' : 'utf8');
    }
    const saved = refresh ? null : await cachedResponse(cacheDir, url);
    if (saved) {
      if (saved.status !== 200) throw new Error(`Upstream HTTP ${saved.status}`);
      return Buffer.from(saved.body, 'base64');
    }
    if (fixture) throw new Error(`Fixture has no captured update response for ${url}`);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unsafe upstream URL');
    const headers = { 'User-Agent': 'freshkeeper-skill-update' };
    if (parsed.hostname === 'api.github.com') {
      if (token === undefined) {
        token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
        if (!token) {
          const auth = await safeExec('gh', ['auth', 'token'], { timeoutMs: Math.min(5000, deadline - Date.now()) }).catch(() => null);
          if (auth?.code === 0) token = auth.stdout.trim();
        }
      }
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))) });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 20 * 1024 * 1024) throw new Error('Upstream file exceeded the size limit');
    await saveResponse(cacheDir, url, response.status, data, response.headers.get('content-type') ?? 'application/json');
    return data;
  }
  function buffer(url, refresh = false) {
    const key = `${url}#${refresh}`;
    if (!pending.has(key)) pending.set(key, fetchBuffer(url, refresh));
    return pending.get(key);
  }
  return { buffer, json: async (url, refresh = false) => JSON.parse((await buffer(url, refresh)).toString()) };
}
