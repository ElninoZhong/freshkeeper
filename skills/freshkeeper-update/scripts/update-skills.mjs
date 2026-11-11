#!/usr/bin/env node
import { prepareUpdate, applyUpdate, summary, loadSavedPlan } from './update-workflow.mjs';
const argv = process.argv.slice(2);
const startedAt = Date.now();
function values(flag) {
  const values = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.push(argv[++i]);
  }
  return values;
}
function option(flag) { const found = values(flag); if (found.length > 1) throw new Error(`Repeated ${flag}`); return found[0]; }
try {
  const valued = new Set(['--plan', '--home', '--from-check', '--write-plan', '--skill', '--fixture', '--provenance-catalog', '--timeout-ms']);
  const flags = new Set(['--apply', '--retry-failed', '--history', '--json', '--quiet', '--help']);
  for (let i = 0; i < argv.length; i++) {
    if (valued.has(argv[i])) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${argv[i]}`); i++; }
    else if (!flags.has(argv[i])) throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (argv.includes('--help')) {
    console.log('update-skills.mjs [--apply] [--skill name] [--from-check report.json] [--write-plan plan.json] [--timeout-ms 180000]\nResume: --plan plan.json --apply [--retry-failed]');
    process.exit(0);
  }
  const timeoutMs = Number(option('--timeout-ms') ?? 180000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3600000) throw new Error('Invalid --timeout-ms');
  const progress = phase => { if (!argv.includes('--quiet')) process.stderr.write(`[freshkeeper-update] ${phase}\n`); };
  const planPath = option('--plan');
  if (argv.includes('--retry-failed') && !planPath) throw new Error('--retry-failed requires --plan; never widen a retry to the whole library');
  if (option('--from-check') && argv.includes('--history')) throw new Error('A reused check keeps its original history mode; create a targeted history check first');
  if (planPath && (option('--from-check') || option('--write-plan') || values('--skill').length || argv.includes('--history')
    || option('--fixture') || option('--provenance-catalog'))) throw new Error('Resume a plan without changing its scope; use --retry-failed');
  let plan = planPath ? await loadSavedPlan(planPath, option('--home')) : await prepareUpdate({ home: option('--home'), skills: values('--skill'),
    fixture: option('--fixture'), catalog: option('--provenance-catalog'), fromCheck: option('--from-check'),
    writePlan: option('--write-plan'), timeoutMs, history: argv.includes('--history'), progress });
  if (argv.includes('--apply')) plan = await applyUpdate(plan, { timeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)), retryFailed: argv.includes('--retry-failed'), progress });
  const result = summary(plan);
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Mode: ${result.mode} | Updated this run: ${result.updated} | Ready: ${result.ready} | Review: ${result.needsReview} | Source issues: ${result.sourceIssues} | Retired: ${result.retired} | Failed: ${result.failed}`);
    for (const item of result.items) console.log(`- ${item.name}: ${item.status}${item.reason ? ' — ' + item.reason : ''}`);
    console.log(`Plan: ${result.planPath}`);
    if (result.backup) console.log(`Verified recovery copy: ${result.backup}`);
  }
  if (result.failed) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
