import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCodexMaterialization, previewCodexMaterialization, readGeneratedFilesManifest } from '../../../src/profiles/materializer.js';
import { ProfileRegistry } from '../../../src/profiles/registry.js';

describe('Codex profile materializer', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-materializer-test-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('creates profile-derived files and records their hashes', () => {
    const result = applyCodexMaterialization(tmpDir, new ProfileRegistry().resolve('generic'));

    expect(result.conflicts).toEqual([]);
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).toContain('Largentic profile: generic');
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).not.toMatch(/Laravel|artisan|phpunit/i);
    expect(readGeneratedFilesManifest(tmpDir)?.files['.codex/agents/planner.toml'].content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('updates an unmodified generated file when selecting another profile', () => {
    applyCodexMaterialization(tmpDir, new ProfileRegistry().resolve('generic'));
    const result = applyCodexMaterialization(tmpDir, new ProfileRegistry().resolve('laravel'));

    expect(result.conflicts).toEqual([]);
    expect(result.changes.some((change) => change.action === 'update')).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).toContain('Largentic profile: laravel');
  });

  it('leaves a developer-edited generated file untouched during refresh', () => {
    const profile = new ProfileRegistry().resolve('generic');
    applyCodexMaterialization(tmpDir, profile);
    const target = path.join(tmpDir, '.codex', 'global-rules.md');
    fs.writeFileSync(target, 'developer rules', 'utf8');

    const result = applyCodexMaterialization(tmpDir, profile, { mode: 'refresh' });
    expect(result.conflicts).toHaveLength(1);
    expect(fs.readFileSync(target, 'utf8')).toBe('developer rules');
  });

  it('previews conflicts and makes a backup before forced replacement', () => {
    const target = path.join(tmpDir, '.codex', 'global-rules.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'custom rules', 'utf8');
    const profile = new ProfileRegistry().resolve('generic');

    expect(previewCodexMaterialization(tmpDir, profile).conflicts).toHaveLength(1);
    const result = applyCodexMaterialization(tmpDir, profile, { force: true });

    expect(result.conflicts).toHaveLength(1);
    expect(fs.readFileSync(target, 'utf8')).not.toBe('custom rules');
    expect(fs.readdirSync(path.dirname(target)).some((file) => file.startsWith('global-rules.md.largentic-backup-'))).toBe(true);
  });
});
