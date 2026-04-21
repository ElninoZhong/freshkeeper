import { installCrontab, uninstallCrontab } from '../scheduler/crontab.js';
import { loadConfig, saveConfig } from '../config.js';
import { log } from '../logger.js';

export async function runSchedule(cron: string): Promise<void> {
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
  log.success('Schedule set: ' + cron);
}
