import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProfileCommands } from '../../../src/profiles/command-resolver.js';
import { ProfileRegistry } from '../../../src/profiles/registry.js';

describe('resolveProfileCommands', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-commands-test-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('uses existing generic project scripts and honours explicit overrides', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }));
    const profile = new ProfileRegistry().resolve('generic');
    const commands = resolveProfileCommands(profile, tmpDir, { test: 'npm run test:focused' });

    expect(commands.packageManager).toBe('npm');
    expect(commands.test).toBe('npm run test:focused');
    expect(commands.sources.test).toBe('project-override');
    expect(commands.lint).toBe('npm run lint');
  });

  it('prefers a Laravel Composer test script over JavaScript package scripts', () => {
    fs.writeFileSync(path.join(tmpDir, 'artisan'), '#!/usr/bin/env php');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    fs.writeFileSync(path.join(tmpDir, 'composer.json'), JSON.stringify({ scripts: { test: 'php artisan test' } }));
    const commands = resolveProfileCommands(new ProfileRegistry().resolve('laravel'), tmpDir);

    expect(commands.packageManager).toBe('composer');
    expect(commands.test).toBe('composer test');
    expect(commands.sources.test).toBe('package-script');
  });

  it('falls back to artisan then phpunit for Laravel projects', () => {
    fs.writeFileSync(path.join(tmpDir, 'artisan'), '#!/usr/bin/env php');
    const artisan = resolveProfileCommands(new ProfileRegistry().resolve('laravel'), tmpDir);
    expect(artisan.test).toBe('php artisan test');

    fs.unlinkSync(path.join(tmpDir, 'artisan'));
    fs.mkdirSync(path.join(tmpDir, 'vendor', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'vendor', 'bin', 'phpunit'), '');
    const phpunit = resolveProfileCommands(new ProfileRegistry().resolve('laravel'), tmpDir);
    expect(phpunit.test).toBe('vendor/bin/phpunit');
  });
});
