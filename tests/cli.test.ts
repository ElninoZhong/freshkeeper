import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { run } from '../src/cli.js';

describe('CLI runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awaits Commander async actions through parseAsync', async () => {
    let finishParsing!: (command: Command) => void;
    const parsing = new Promise<Command>((resolve) => {
      finishParsing = resolve;
    });
    const parseAsync = vi.spyOn(Command.prototype, 'parseAsync').mockReturnValue(parsing);
    let completed = false;

    const running = run().then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(parseAsync).toHaveBeenCalledWith(process.argv);
    expect(completed).toBe(false);

    finishParsing(new Command());
    await running;
    expect(completed).toBe(true);
  });
});
