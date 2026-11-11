import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
for (const name of ['check-installed-skills.mjs', 'provenance.mjs', 'version-tracking.mjs', 'actions.mjs']) {
  await copyFile(fileURLToPath(new URL('../skills/freshkeeper-check/scripts/' + name, import.meta.url)),
    fileURLToPath(new URL('../skills/freshkeeper-update/scripts/' + name, import.meta.url)));
}
