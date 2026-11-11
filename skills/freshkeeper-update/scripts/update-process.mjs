import { spawn } from 'node:child_process';

// Argument-vector seam: never evaluate user/system data through a shell.
export function safeExec(command, args, { input, env = process.env, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    const chunks = [], errors = []; let bytes = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); }
      catch { child.kill('SIGTERM'); }
    }, Math.max(1, timeoutMs));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('close', code => {
      clearTimeout(timer);
      const output = { code, stdout: Buffer.concat(chunks).toString(), stderr: Buffer.concat(errors).toString() };
      if (timedOut) reject(new Error('Update time budget exceeded; resume only pending items'));
      else if (bytes > 32 * 1024 * 1024) reject(new Error('Checker response exceeded the output limit'));
      else resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
