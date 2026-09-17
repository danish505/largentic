import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { RunManifest, RunState } from '../types.js';
import { StateStore } from '../state/state-store.js';
import { HARNESS_DIR_NAME } from '../constants.js';

const SCHEMA_VERSION = '2.0' as const;
let stateValidator: ValidateFunction | null = null;

export interface RunPaths {
  runDir: string;
  manifestFile: string;
  stateFile: string;
  eventsFile: string;
  summaryFile: string;
  attemptDir: (n: number) => string;
}

export class RunManager {
  private baseDir: string;

  constructor(cwd: string) {
    this.baseDir = path.join(cwd, HARNESS_DIR_NAME, 'runs');
  }

  create(task: string, options: { profile: string; provider: string; gitBranch?: string; gitCommit?: string }): { runId: string; paths: RunPaths; manifest: RunManifest } {
    const runId = ulid();
    const runDir = path.join(this.baseDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, 'attempts', '1'), { recursive: true });

    const manifest: RunManifest = {
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      task,
      profile: options.profile,
      provider: options.provider,
      created_at: new Date().toISOString(),
      cwd: process.cwd(),
      git_branch: options.gitBranch,
      git_commit: options.gitCommit,
    };

    const paths = this.buildPaths(runDir);
    fs.writeFileSync(paths.manifestFile, JSON.stringify(manifest, null, 2), 'utf8');

    const store = new StateStore(runDir);
    store.initialize(runId);

    return { runId, paths, manifest };
  }

  load(runId: string): { runDir: string; paths: RunPaths } {
    const runDir = path.join(this.baseDir, runId);
    if (!fs.existsSync(runDir)) {
      throw new Error(`Run not found: ${runId}`);
    }
    return { runDir, paths: this.buildPaths(runDir) };
  }

  /** Load one existing run and reject inconsistent manifest/state pairs. */
  loadExisting(runId: string): { runDir: string; paths: RunPaths; manifest: RunManifest; state: RunState } {
    const { runDir, paths } = this.load(runId);
    let manifest: unknown;
    let state: unknown;

    try {
      manifest = JSON.parse(fs.readFileSync(paths.manifestFile, 'utf8'));
      state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Run ${runId} has unreadable manifest or state: ${message}`);
    }

    assertValidManifest(manifest, runId);
    assertValidState(state, runId);

    const typedManifest = manifest as RunManifest;
    const typedState = state as RunState;
    if (typedManifest.run_id !== runId || typedState.run_id !== runId || typedManifest.run_id !== typedState.run_id) {
      throw new Error(`Run ${runId} has inconsistent manifest and state run IDs.`);
    }

    return { runDir, paths, manifest: typedManifest, state: typedState };
  }

  list(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs.readdirSync(this.baseDir).filter((entry) => {
      return fs.statSync(path.join(this.baseDir, entry)).isDirectory();
    });
  }

  private buildPaths(runDir: string): RunPaths {
    return {
      runDir,
      manifestFile: path.join(runDir, 'manifest.json'),
      stateFile:    path.join(runDir, 'state.json'),
      eventsFile:   path.join(runDir, 'events.jsonl'),
      summaryFile:  path.join(runDir, 'summary.md'),
      attemptDir:   (n: number) => path.join(runDir, 'attempts', String(n)),
    };
  }
}

function assertValidState(value: unknown, runId: string): void {
  if (!stateValidator) {
    const schemaPath = path.resolve(__dirname, '../../schemas/state.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    stateValidator = ajv.compile(schema);
  }

  if (!stateValidator(value)) {
    const errors = (stateValidator.errors ?? [])
      .map((error) => `${error.instancePath || '(root)'} ${error.message}`)
      .join('; ');
    throw new Error(`Run ${runId} has invalid state: ${errors}`);
  }
}

function assertValidManifest(value: unknown, runId: string): void {
  if (!isRecord(value)) {
    throw new Error(`Run ${runId} has invalid manifest: expected an object.`);
  }

  const requiredStringFields = ['schema_version', 'run_id', 'task', 'profile', 'provider', 'created_at', 'cwd'];
  const invalidFields = requiredStringFields.filter((field) => {
    const fieldValue = value[field];
    return typeof fieldValue !== 'string' || !fieldValue.trim();
  });
  if (invalidFields.length > 0 || value.schema_version !== SCHEMA_VERSION) {
    const details = invalidFields.length > 0 ? `missing or invalid ${invalidFields.join(', ')}` : 'unsupported schema_version';
    throw new Error(`Run ${runId} has invalid manifest: ${details}.`);
  }

  for (const field of ['git_branch', 'git_commit']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error(`Run ${runId} has invalid manifest: ${field} must be a string.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
