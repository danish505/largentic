import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profileApplyCommand, profileDiffCommand } from '../../../src/cli/commands/profile.js';

describe('profile CLI commands', () => {
  let tmpDir: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-cli-test-'));
    fs.mkdirSync(path.join(tmpDir, '.largentic'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.largentic', 'config.yaml'), 'version: 2\nprofile: generic\n');
    stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('diffs without writing and applies a selected profile safely', () => {
    profileDiffCommand(tmpDir, 'laravel');
    expect(fs.existsSync(path.join(tmpDir, '.codex'))).toBe(false);

    profileApplyCommand(tmpDir, 'laravel');
    expect(fs.readFileSync(path.join(tmpDir, '.largentic', 'config.yaml'), 'utf8')).toContain('profile: laravel');
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).toContain('Largentic profile: laravel');
  });

  it('does not select a profile when an unmanaged Codex file conflicts', () => {
    fs.mkdirSync(path.join(tmpDir, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'developer owned');

    profileApplyCommand(tmpDir, 'laravel');

    expect(process.exitCode).toBe(1);
    expect(fs.readFileSync(path.join(tmpDir, '.largentic', 'config.yaml'), 'utf8')).toContain('profile: generic');
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'global-rules.md'), 'utf8')).toBe('developer owned');
  });
});
