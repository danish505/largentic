import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { tryWriteCycleSummary, writeCycleSummary } from '../../../src/engine/cycle-summary.js';
import { RunManager } from '../../../src/engine/run-manager.js';
import type { RunState } from '../../../src/types.js';

describe('writeCycleSummary', () => {
  const directories: string[] = [];

  afterEach(() => {
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  it('writes a concise summary from the completed stage artifacts', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cycle-summary-test-'));
    directories.push(cwd);
    const { runId, paths } = new RunManager(cwd).create('Add a cycle summary', { profile: 'generic', provider: 'fake' });
    fs.writeFileSync(path.join(paths.runDir, 'implementation.md'), '## Implemented\n\n- Added `summary.md`.\n\n## Verification\n\nInternal notes.', 'utf8');
    fs.writeFileSync(path.join(paths.runDir, 'test-results.md'), '## Results\n\nAll focused tests passed.\n\n## Remaining Risk\n\nNone.', 'utf8');
    fs.writeFileSync(path.join(paths.runDir, 'review.md'), '## Verdict\n\nAPPROVE\n\n## Summary\n\nReady to merge.', 'utf8');

    const state: RunState = {
      schema_version: '2.0',
      run_id: runId,
      status: 'approved',
      attempt: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:01:00.000Z',
    };
    const summary = writeCycleSummary({ paths, task: 'Add a cycle summary', state });

    expect(summary).toContain('**Status:** APPROVED');
    expect(summary).toContain('- Added `summary.md`.');
    expect(summary).toContain('All focused tests passed.');
    expect(summary).toContain('APPROVE');
    expect(summary).not.toContain('Internal notes.');
    expect(fs.readFileSync(paths.summaryFile, 'utf8')).toBe(summary);
  });

  it('uses explicit fallbacks when a cancelled run has no stage artifacts', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cycle-summary-test-'));
    directories.push(cwd);
    const { runId, paths } = new RunManager(cwd).create('Cancelled run', { profile: 'generic', provider: 'fake' });
    const state: RunState = {
      schema_version: '2.0',
      run_id: runId,
      status: 'cancelled',
      attempt: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:01:00.000Z',
      failure_reason: 'Cancellation requested by user',
    };

    const summary = writeCycleSummary({ paths, task: 'Cancelled run', state });

    expect(summary).toContain('No implementation summary was produced.');
    expect(summary).toContain('Cancellation requested by user');
  });

  it('reports a write failure without throwing', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cycle-summary-test-'));
    directories.push(cwd);
    const { runId, paths } = new RunManager(cwd).create('Summary write failure', { profile: 'generic', provider: 'fake' });
    fs.rmSync(paths.runDir, { recursive: true, force: true });
    const state: RunState = {
      schema_version: '2.0',
      run_id: runId,
      status: 'approved',
      attempt: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:01:00.000Z',
    };

    expect(tryWriteCycleSummary({ paths, task: 'Summary write failure', state })).toMatchObject({
      error: expect.stringContaining('ENOENT'),
    });
  });
});
