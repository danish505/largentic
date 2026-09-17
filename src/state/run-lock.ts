import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const LOCK_FILE = '.lock';

interface LockOwner {
  pid: number;
  token: string;
  created_at: string;
}

export class RunLock {
  private lockPath: string;
  private token: string | null = null;

  constructor(runDir: string) {
    this.lockPath = path.join(runDir, LOCK_FILE);
  }

  /** Acquire an exclusive lock, recovering only locks held by a dead process. */
  acquire(): void {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = randomUUID();
      const owner: LockOwner = {
        pid: process.pid,
        token,
        created_at: new Date().toISOString(),
      };

      try {
        const descriptor = fs.openSync(this.lockPath, 'wx');
        try {
          fs.writeFileSync(descriptor, JSON.stringify(owner), 'utf8');
        } catch (error: unknown) {
          fs.unlinkSync(this.lockPath);
          throw error;
        } finally {
          fs.closeSync(descriptor);
        }
        this.token = token;
        return;
      } catch (error: unknown) {
        if (!isAlreadyExistsError(error)) throw error;
        this.recoverStaleLock();
      }
    }

    throw new Error('Unable to acquire run lock after recovering a stale lock. Try again.');
  }

  /** Release only the lock created by this instance. */
  release(): void {
    if (!this.token) return;

    const owner = this.readOwner();
    if (owner?.token === this.token) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch (error: unknown) {
        if (!isNotFoundError(error)) throw error;
      }
    }
    this.token = null;
  }

  isLocked(): boolean {
    return fs.existsSync(this.lockPath);
  }

  isHeldByLiveProcess(): boolean {
    const owner = this.readOwner();
    return owner ? isProcessAlive(owner.pid) : false;
  }

  private recoverStaleLock(): void {
    const owner = this.readOwner();
    if (!owner) {
      throw new Error(`Run lock is unreadable: ${this.lockPath}. Remove it manually after confirming no workflow is running.`);
    }
    if (isProcessAlive(owner.pid)) {
      throw new Error(`Run is locked by active process ${owner.pid}. Wait for it to finish or cancel it from that process.`);
    }

    const quarantinedPath = `${this.lockPath}.stale-${randomUUID()}`;
    try {
      fs.renameSync(this.lockPath, quarantinedPath);
    } catch (error: unknown) {
      if (isNotFoundError(error)) return;
      throw error;
    }
    fs.unlinkSync(quarantinedPath);
  }

  private readOwner(): LockOwner | null {
    try {
      const raw = fs.readFileSync(this.lockPath, 'utf8').trim();
      const parsed = JSON.parse(raw) as Partial<LockOwner>;
      if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0 ||
        typeof parsed.token !== 'string' || !parsed.token) {
        return null;
      }
      return parsed as LockOwner;
    } catch {
      return null;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
