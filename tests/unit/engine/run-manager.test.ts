import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunManager } from '../../../src/engine/run-manager.js';

describe('RunManager.loadExisting', () => {
  const directories: string[] = [];

  afterEach(() => {
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  function createRun(): { manager: RunManager; runId: string; stateFile: string; manifestFile: string } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-run-manager-test-'));
    directories.push(directory);
    const manager = new RunManager(directory);
    const { runId, paths } = manager.create('Validate persisted data', { profile: 'generic', provider: 'fake' });
    return { manager, runId, stateFile: paths.stateFile, manifestFile: paths.manifestFile };
  }

  it('loads a schema-valid manifest and state', () => {
    const { manager, runId } = createRun();

    expect(manager.loadExisting(runId).state.status).toBe('created');
  });

  it('rejects a parseable state with an invalid status', () => {
    const { manager, runId, stateFile } = createRun();
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.status = 'unknown_status';
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');

    expect(() => manager.loadExisting(runId)).toThrow(/invalid state.*status/);
  });

  it('rejects a state missing a required timestamp', () => {
    const { manager, runId, stateFile } = createRun();
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    delete state.created_at;
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');

    expect(() => manager.loadExisting(runId)).toThrow(/invalid state.*created_at/);
  });

  it('rejects a parseable manifest missing required fields', () => {
    const { manager, runId, manifestFile } = createRun();
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    delete manifest.task;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), 'utf8');

    expect(() => manager.loadExisting(runId)).toThrow(/invalid manifest.*task/);
  });
});
