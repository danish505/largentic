import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { findConfigPath, loadConfig } from '../../config/loader.js';
import { HARNESS_DIR_NAME } from '../../constants.js';
import { detectProfile } from '../../profiles/detector.js';
import { applyCodexMaterialization, previewCodexMaterialization, type MaterializationResult } from '../../profiles/materializer.js';
import { ProfileRegistry } from '../../profiles/registry.js';

export function profileListCommand(cwd: string): void {
  try {
    const profiles = registryFor(cwd).list();
    console.log('Available profiles:');
    profiles.forEach((profile) => console.log(`  ${profile.id.padEnd(20)} ${profile.version.padEnd(10)} ${profile.source} — ${profile.name}`));
  } catch (error: unknown) {
    fail(error);
  }
}

export function profileDetectCommand(cwd: string): void {
  const detection = detectProfile(cwd);
  console.log(`Detected profile: ${detection.profile}`);
  detection.evidence.forEach((evidence) => console.log(`  • ${evidence.message}`));
  if (Object.keys(detection.runtime).length > 0) console.log(`Runtime: ${yaml.dump(detection.runtime).trim()}`);
  console.log('Project-local profiles are never auto-detected; select one explicitly in .largentic/config.yaml.');
}

export function profileShowCommand(cwd: string, id?: string): void {
  try {
    const profile = registryFor(cwd).resolve(id ?? activeProfileId(cwd));
    console.log(yaml.dump(profile, { noRefs: true, lineWidth: -1 }));
  } catch (error: unknown) {
    fail(error);
  }
}

export function profileDiffCommand(cwd: string, id?: string): void {
  try {
    const profile = registryFor(cwd).resolve(id ?? activeProfileId(cwd));
    printMaterialization(previewCodexMaterialization(cwd, profile));
  } catch (error: unknown) {
    fail(error);
  }
}

export function profileApplyCommand(cwd: string, id: string, options: { force?: boolean } = {}): void {
  try {
    const profile = registryFor(cwd).resolve(id);
    const preview = previewCodexMaterialization(cwd, profile);
    if (preview.conflicts.length > 0 && !options.force) {
      printMaterialization(preview);
      console.error('Profile was not selected because materialization conflicts must be resolved first. Use --force to back up and replace conflicting files.');
      process.exitCode = 1;
      return;
    }
    const result = applyCodexMaterialization(cwd, profile, { force: options.force });
    printMaterialization(result);
    setActiveProfile(cwd, id);
    console.log(`Selected profile: ${id}`);
  } catch (error: unknown) {
    fail(error);
  }
}

export function profileRefreshCommand(cwd: string, options: { force?: boolean } = {}): void {
  try {
    const profile = registryFor(cwd).resolve(activeProfileId(cwd));
    const result = applyCodexMaterialization(cwd, profile, { force: options.force, mode: 'refresh' });
    printMaterialization(result);
    if (result.conflicts.length > 0 && !options.force) {
      console.error('Refresh left conflicting files untouched. Use --force to back up and replace modified files.');
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    fail(error);
  }
}

function registryFor(cwd: string): ProfileRegistry {
  return new ProfileRegistry(undefined, cwd);
}

function activeProfileId(cwd: string): string {
  const result = loadConfig(findConfigPath(cwd));
  if (!result.valid) throw new Error(`Cannot determine active profile: ${result.errors.join('; ')}`);
  return result.config.profile;
}

function setActiveProfile(cwd: string, id: string): void {
  const configPath = findConfigPath(cwd);
  if (!fs.existsSync(configPath)) throw new Error(`Config file not found: ${configPath}. Run "lh init" first.`);
  const source = fs.readFileSync(configPath, 'utf8');
  const profileLine = /^([ \t]*profile:[ \t]*).*$/m;
  const updated = profileLine.test(source)
    ? source.replace(profileLine, `$1${id}`)
    : `${source.replace(/\s*$/, '\n')}\nprofile: ${id}\n`;
  fs.writeFileSync(configPath, updated, 'utf8');
}

function printMaterialization(result: MaterializationResult): void {
  result.changes.forEach((change) => {
    const suffix = change.reason ? ` (${change.reason})` : '';
    console.log(`  ${change.action.toUpperCase().padEnd(9)} ${change.path}${suffix}`);
  });
}

function fail(error: unknown): void {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
