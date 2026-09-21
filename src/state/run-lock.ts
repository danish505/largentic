import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const LOCK_FILE = '.lock';
const LOCK_TIMEOUT_MS = 30_000;
interface LockData { pid: number; token: string; acquired_at: string; heartbeat_at: string; }

export class RunLock {
  private lockPath: string;
  private token: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(runDir: string) { this.lockPath = path.join(runDir, LOCK_FILE); }

  acquire(): void {
    const data: LockData = { pid: process.pid, token: crypto.randomUUID(), acquired_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() };
    try {
      fs.writeFileSync(this.lockPath, JSON.stringify(data), { encoding: 'utf8', flag: 'wx' });
      this.token = data.token;
      this.heartbeatTimer = setInterval(() => this.heartbeat(), Math.floor(LOCK_TIMEOUT_MS / 3));
      this.heartbeatTimer.unref();
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const existing = this.read();
    if (existing && this.isStale(existing)) {
      try { fs.unlinkSync(this.lockPath); } catch { /* exclusive create below determines ownership */ }
      return this.acquire();
    }
    throw new Error(`Run is locked by ${existing ? `process ${existing.pid}` : 'an unknown process'}. Wait for it to finish before resuming or cancelling.`);
  }

  heartbeat(): void {
    const existing = this.read();
    if (!this.token || !existing || existing.token !== this.token) return;
    existing.heartbeat_at = new Date().toISOString();
    fs.writeFileSync(this.lockPath, JSON.stringify(existing), 'utf8');
  }

  release(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const existing = this.read();
    if (this.token && existing?.token === this.token) fs.unlinkSync(this.lockPath);
    this.token = null;
  }

  isLocked(): boolean { return fs.existsSync(this.lockPath); }

  clearIfStale(): boolean {
    const existing = this.read();
    if (!existing || !this.isStale(existing)) return false;
    fs.unlinkSync(this.lockPath);
    return true;
  }

  private read(): LockData | null {
    try {
      const value = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as Partial<LockData>;
      return typeof value.pid === 'number' && typeof value.token === 'string' && typeof value.heartbeat_at === 'string' ? value as LockData : null;
    } catch { return null; }
  }

  private isStale(lock: LockData): boolean {
    const heartbeat = new Date(lock.heartbeat_at).getTime();
    if (!Number.isFinite(heartbeat) || Date.now() - heartbeat < LOCK_TIMEOUT_MS) return false;
    try { process.kill(lock.pid, 0); return false; } catch (error: unknown) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }
}
