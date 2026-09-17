import * as fs from 'fs';
import * as path from 'path';

const REQUEST_FILE = '.cancel-requested';

export function requestCancellation(runDir: string): void {
  fs.writeFileSync(path.join(runDir, REQUEST_FILE), new Date().toISOString(), 'utf8');
}

export function isCancellationRequested(runDir: string): boolean {
  return fs.existsSync(path.join(runDir, REQUEST_FILE));
}

export function clearCancellationRequest(runDir: string): void {
  const requestPath = path.join(runDir, REQUEST_FILE);
  if (fs.existsSync(requestPath)) fs.unlinkSync(requestPath);
}
