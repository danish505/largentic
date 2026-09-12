import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { afterEach, beforeEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { detectProfile } from '../../../src/profiles/detector.js';

const fixtures = path.resolve(__dirname, '../../fixtures/projects');

describe('detectProfile fixtures', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-detect-test-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  it('identifies the Laravel fixture with evidence', () => {
    const result = detectProfile(path.join(fixtures, 'laravel'));
    expect(result.profile).toBe('laravel');
    expect(result.hints.join('\n')).toMatch(/artisan/i);
    expect(result.evidence.some((evidence) => evidence.kind === 'artisan')).toBe(true);
  });

  it('extracts Composer runtime metadata without executing project code', () => {
    const result = detectProfile(path.join(fixtures, 'laravel'));
    expect(result.runtime.laravel).toBe('^11.0');
  });

  it('does not auto-detect a project-local profile', () => {
    fs.mkdirSync(path.join(tmpDir, '.largentic', 'profiles', 'custom'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.largentic', 'profiles', 'custom', 'profile.yaml'), 'schema_version: 1');
    expect(detectProfile(tmpDir).profile).toBe('generic');
  });

  it('uses the generic fixture as the safe fallback', () => {
    const result = detectProfile(path.join(fixtures, 'generic'));
    expect(result.profile).toBe('generic');
    expect(result.hints.join('\n')).toMatch(/generic/i);
  });
});
