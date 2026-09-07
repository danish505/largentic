import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initCommand } from '../../../src/cli/commands/init.js';
import { getCodexProjectConfigError } from '../../../src/providers/codex-preflight.js';

const fixtures = path.resolve(__dirname, '../../fixtures');

describe('profile initialization in fresh project fixtures', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-init-integration-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('initializes a generic repository without Laravel guidance', () => {
    fs.cpSync(path.join(fixtures, 'projects', 'generic'), tmpDir, { recursive: true });
    initCommand(tmpDir);

    expect(fs.readFileSync(path.join(tmpDir, '.largentic', 'config.yaml'), 'utf8')).toContain('profile: generic');
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).not.toMatch(/Laravel|artisan|phpunit/i);
    expect(getCodexProjectConfigError(tmpDir)).toBeNull();
  });

  it('initializes a Laravel repository with Laravel guidance', () => {
    fs.cpSync(path.join(fixtures, 'projects', 'laravel'), tmpDir, { recursive: true });
    initCommand(tmpDir);

    expect(fs.readFileSync(path.join(tmpDir, '.largentic', 'config.yaml'), 'utf8')).toContain('profile: laravel');
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).toContain('Largentic profile: laravel');
  });

  it('selects a manually authored local profile explicitly', () => {
    const localProfile = path.join(tmpDir, '.largentic', 'profiles', 'example-service');
    fs.mkdirSync(path.dirname(localProfile), { recursive: true });
    fs.cpSync(path.join(fixtures, 'profiles', 'example-service'), localProfile, { recursive: true });

    initCommand(tmpDir, { profile: 'example-service' });

    expect(fs.readFileSync(path.join(tmpDir, '.largentic', 'config.yaml'), 'utf8')).toContain('profile: example-service');
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).toContain('Example service guidance');
  });
});
