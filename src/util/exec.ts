import { execa } from 'execa';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
}

export async function safeExec(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string }
): Promise<ExecResult> {
  try {
    const r = await execa(cmd, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      input: opts?.input,
      reject: false,
      timeout: opts?.timeoutMs
    });
    return {
      ok: r.exitCode === 0 && !r.failed,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode ?? undefined,
      error: r.failed ? r.shortMessage : undefined
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
