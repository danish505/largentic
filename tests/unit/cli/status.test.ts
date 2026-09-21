import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelCommand } from '../../../src/cli/commands/status.js';
import { RunManager } from '../../../src/engine/run-manager.js';
import { StateStore } from '../../../src/state/state-store.js';
import { RunLock } from '../../../src/state/run-lock.js';

describe('cancelCommand', () => {
  const dirs: string[] = [];

  afterEach(() => {
    dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    process.exitCode = undefined;
  });

  it('does not mutate state or events when another live process owns the lock', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cancel-test-'));
    dirs.push(cwd);
    const manager = new RunManager(cwd);
    const created = manager.create('Keep this run active', { profile: 'generic', provider: 'fake' });
    new StateStore(created.paths.runDir).transition('planning', { actor: 'system' });
    const lock = new RunLock(created.paths.runDir);
    lock.acquire();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    cancelCommand(created.runId, cwd);

    expect(new StateStore(created.paths.runDir).read().status).toBe('planning');
    expect(fs.existsSync(created.paths.eventsFile)).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('actively locked'));
    lock.release();
    error.mockRestore();
  });
});
