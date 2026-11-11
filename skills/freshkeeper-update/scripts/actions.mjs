// An action is advice, never authorization to change a Skill or its metadata.
export function nextAction(item) {
  let group, label;
  if (item.evidenceError) [group, label] = ['sourceRepairs', '修复这项来源证据引用后局部复查'];
  else if (['check-failed', 'check-blocked'].includes(item.status)) [group, label] = ['retry', '仅重试这项；失败不代表已经最新'];
  else if (['missing-upstream', 'legacy-local'].includes(item.status)) [group, label] = ['retired', '核实上游移除或迁移情况；保留本地技能'];
  else if (['untracked', 'unresolved', 'uncheckable', 'local-only'].includes(item.status)) [group, label] = ['sourceRepairs', '核实并补全来源登记；不要猜填'];
  else if (['clean-old', 'current-subset'].includes(item.status)
    || (item.status === 'update-available' && item.sourceType === 'well-known')) [group, label] = ['updateCandidates', '已证明更新基线；按授权更新并保留本地扩展'];
  else if (['manual-merge', 'needs-review', 'update-available'].includes(item.status)) [group, label] = ['needsReview', '先查看差异；需要时只对这项追溯历史'];
  else [group, label] = ['noAction', item.status === 'local-modified' ? '上游基线一致；保留本地适配' : '当前无需处理'];
  return { name: item.name, realPath: item.realPath, status: item.status, group, label,
    reason: item.reason, ...(group === 'needsReview' ? { suggestedArgs: ['--history', '--skill', item.name] }
      : group === 'retry' || group === 'sourceRepairs' ? { suggestedArgs: ['--skill', item.name] } : {}) };
}
export function actionPlan(items) {
  const groups = { updateCandidates: [], needsReview: [], sourceRepairs: [], retired: [], retry: [], noAction: [] };
  for (const item of items) { const action = nextAction(item); groups[action.group].push(action); }
  return groups;
}
