import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunManager } from '../../../src/engine/run-manager.js';

describe('RunManager validation', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it('skips malformed records while returning valid newest summaries', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-run-manager-test-'));
    dirs.push(cwd);
    const manager = new RunManager(cwd);
    const valid = manager.create('Valid task', { profile: 'generic', provider: 'fake' });
    const malformed = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const dir = path.join(cwd, '.largentic', 'runs', malformed);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema_version: '2.0', run_id: malformed, task: 3 }), 'utf8');
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ schema_version: '2.0', run_id: malformed, status: 'created', attempt: 0, created_at: 'bad', updated_at: 'bad' }), 'utf8');

    const result = manager.listSummaries();

    expect(result.summaries.map((item) => item.runId)).toEqual([valid.runId]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(malformed);
    expect(result.warnings[0]).not.toContain(cwd);
    expect(result.warnings[0]).not.toContain('SyntaxError');
    expect(() => manager.load(malformed)).toThrow(`Run ${malformed} metadata is invalid.`);
  });

  it.each(['2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+01:00', '2026-01-01'])('rejects non-canonical timestamp %s', (timestamp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-run-manager-test-'));
    dirs.push(cwd);
    const manager = new RunManager(cwd);
    const created = manager.create('Valid task', { profile: 'generic', provider: 'fake' });
    const state = JSON.parse(fs.readFileSync(created.paths.stateFile, 'utf8')) as Record<string, unknown>;
    state.updated_at = timestamp;
    fs.writeFileSync(created.paths.stateFile, JSON.stringify(state), 'utf8');

    expect(() => manager.load(created.runId)).toThrow(/metadata is invalid/);
  });

  it('accepts canonical UTC timestamps including leap day', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-run-manager-test-'));
    dirs.push(cwd);
    const manager = new RunManager(cwd);
    const created = manager.create('Valid task', { profile: 'generic', provider: 'fake' });
    const manifest = JSON.parse(fs.readFileSync(created.paths.manifestFile, 'utf8')) as Record<string, unknown>;
    const state = JSON.parse(fs.readFileSync(created.paths.stateFile, 'utf8')) as Record<string, unknown>;
    manifest.created_at = '2024-02-29T23:59:59.123Z';
    state.created_at = '2024-02-29T23:59:59Z';
    state.updated_at = '2024-02-29T23:59:59.123456789Z';
    fs.writeFileSync(created.paths.manifestFile, JSON.stringify(manifest), 'utf8');
    fs.writeFileSync(created.paths.stateFile, JSON.stringify(state), 'utf8');

    expect(manager.load(created.runId).state.updated_at).toContain('2024-02-29');
  });

  it('uses a path-free warning when metadata disappears', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-run-manager-test-'));
    dirs.push(cwd);
    const manager = new RunManager(cwd);
    const created = manager.create('Valid task', { profile: 'generic', provider: 'fake' });
    fs.unlinkSync(created.paths.stateFile);

    const result = manager.listSummaries();

    expect(result.summaries).toEqual([]);
    expect(result.warnings).toEqual([`Skipping run ${created.runId}: metadata unavailable.`]);
    expect(result.warnings[0]).not.toContain(cwd);
    expect(result.warnings[0]).not.toContain('ENOENT');
  });
});
