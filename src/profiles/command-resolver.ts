import * as fs from 'fs';
import * as path from 'path';
import type { EffectiveProfile, ResolvedCommands } from './types.js';

export interface CommandOverrides {
  test?: string;
  build?: string;
  lint?: string;
  typecheck?: string;
}

type PackageManifest = { scripts?: Record<string, string> };

export function resolveProfileCommands(
  profile: EffectiveProfile,
  cwd: string,
  overrides: CommandOverrides = {}
): ResolvedCommands {
  const packageManager = detectPackageManager(profile, cwd);
  const scripts = readPackageScripts(cwd);
  const resolved: ResolvedCommands = { packageManager, sources: {} };

  applyCommand(resolved, 'test', overrides.test, 'project-override');
  applyCommand(resolved, 'build', overrides.build, 'project-override');
  applyCommand(resolved, 'lint', overrides.lint, 'project-override');
  applyCommand(resolved, 'typecheck', overrides.typecheck, 'project-override');

  if (!resolved.test && profile.id === 'laravel') {
    const composer = readComposer(cwd);
    if (composer?.scripts?.test) applyCommand(resolved, 'test', 'composer test', 'package-script');
    else if (fs.existsSync(path.join(cwd, 'artisan'))) applyCommand(resolved, 'test', 'php artisan test', 'framework-fallback');
    else if (fs.existsSync(path.join(cwd, 'vendor', 'bin', 'phpunit'))) applyCommand(resolved, 'test', 'vendor/bin/phpunit', 'framework-fallback');
  }

  for (const name of ['test', 'build', 'lint', 'typecheck'] as const) {
    if (resolved[name]) continue;
    if (scripts[name] && packageManager) applyCommand(resolved, name, `${packageManager} run ${name}`, 'package-script');
  }

  for (const name of ['test', 'build', 'lint', 'typecheck'] as const) {
    if (resolved[name]) continue;
    const profileCommand = profile.commands[name];
    if (profileCommand) applyCommand(resolved, name, profileCommand.replace('{pm}', packageManager ?? 'npm'), 'profile-default');
  }

  return resolved;
}

function applyCommand(
  resolved: ResolvedCommands,
  name: 'test' | 'build' | 'lint' | 'typecheck',
  command: string | undefined,
  source: ResolvedCommands['sources'][typeof name]
): void {
  if (!command) return;
  resolved[name] = command;
  resolved.sources[name] = source;
}

function detectPackageManager(profile: EffectiveProfile, cwd: string): string | null {
  if (profile.commands.package_manager && profile.commands.package_manager !== 'auto') return profile.commands.package_manager;
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'package.json'))) return 'npm';
  return null;
}

function readPackageScripts(cwd: string): Record<string, string> {
  const manifestPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageManifest).scripts ?? {};
  } catch {
    return {};
  }
}

function readComposer(cwd: string): { scripts?: Record<string, string | string[]> } | undefined {
  const manifestPath = path.join(cwd, 'composer.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { scripts?: Record<string, string | string[]> };
  } catch {
    return undefined;
  }
}
