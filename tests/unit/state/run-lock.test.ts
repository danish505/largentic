import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunLock } from '../../../src/state/run-lock.js';

describe('RunLock', () => {
  const directories: string[] = [];

  afterEach(() => {
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  function makeRunDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-run-lock-test-'));
    directories.push(directory);
    return directory;
  }

  it('prevents a second instance from acquiring a live lock', () => {
    const runDirectory = makeRunDirectory();
    const first = new RunLock(runDirectory);
    const second = new RunLock(runDirectory);

    first.acquire();
    expect(() => second.acquire()).toThrow(/active process/);
    first.release();
  });

  it('recovers a lock whose owner process is confirmed dead', () => {
    const runDirectory = makeRunDirectory();
    fs.writeFileSync(
      path.join(runDirectory, '.lock'),
      JSON.stringify({ pid: 99999999, token: 'abandoned', created_at: new Date().toISOString() }),
      'utf8'
    );

    const lock = new RunLock(runDirectory);
    lock.acquire();

    expect(lock.isLocked()).toBe(true);
    lock.release();
    expect(lock.isLocked()).toBe(false);
  });

  it('does not remove a lock whose ownership token has changed', () => {
    const runDirectory = makeRunDirectory();
    const lock = new RunLock(runDirectory);
    lock.acquire();
    fs.writeFileSync(
      path.join(runDirectory, '.lock'),
      JSON.stringify({ pid: process.pid, token: 'replacement', created_at: new Date().toISOString() }),
      'utf8'
    );

    lock.release();
    expect(fs.existsSync(path.join(runDirectory, '.lock'))).toBe(true);
  });

  it('refuses to remove an unreadable lock automatically', () => {
    const runDirectory = makeRunDirectory();
    fs.writeFileSync(path.join(runDirectory, '.lock'), 'not a lock record', 'utf8');

    expect(() => new RunLock(runDirectory).acquire()).toThrow(/unreadable/);
  });
});
