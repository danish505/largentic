import * as fs from 'fs';
import * as path from 'path';
import { composeProfiles } from './composer.js';
import { ProfileLoader } from './loader.js';
import type { EffectiveProfile } from './types.js';
import { ProfileValidationError, ProfileValidator } from './validator.js';

export interface ProfileSummary {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'project-local';
}

export class ProfileRegistry {
  private readonly profilesRoot: string;
  private readonly validator: ProfileValidator;
  private readonly loader: ProfileLoader;

  constructor(
    profilesRoot = path.resolve(__dirname, '../../profiles'),
    private readonly projectRoot?: string
  ) {
    this.profilesRoot = profilesRoot;
    this.validator = new ProfileValidator();
    this.loader = new ProfileLoader(this.validator);
  }

  list(): ProfileSummary[] {
    if (!fs.existsSync(this.profilesRoot)) return [];
    const builtins = fs.readdirSync(this.profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(this.profilesRoot, entry.name, 'profile.yaml')))
      .map((entry) => this.loader.load(path.join(this.profilesRoot, entry.name), 'builtin', entry.name))
      .map(({ definition }) => ({ id: definition.id, name: definition.name, version: definition.version, source: 'builtin' as const }));
    const localRoot = this.localProfilesRoot();
    const locals = localRoot && fs.existsSync(localRoot)
      ? fs.readdirSync(localRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(localRoot, entry.name, 'profile.yaml')))
        .map((entry) => this.loader.load(path.join(localRoot, entry.name), 'project-local', entry.name))
        .map(({ definition }) => ({ id: definition.id, name: definition.name, version: definition.version, source: 'project-local' as const }))
      : [];
    return [...builtins, ...locals].sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
  }

  has(id: string): boolean {
    try { this.resolve(id); return true; } catch { return false; }
  }

  resolve(id: string): EffectiveProfile {
    this.validator.assertProfileId(id);
    const localRoot = this.localProfilesRoot();
    const localProfileRoot = localRoot ? path.join(localRoot, id) : undefined;
    const builtinRoot = path.join(this.profilesRoot, id);
    const selectedRoot = localProfileRoot && fs.existsSync(path.join(localProfileRoot, 'profile.yaml'))
      ? localProfileRoot
      : builtinRoot;
    const source = selectedRoot === localProfileRoot ? 'project-local' : 'builtin';
    if (!fs.existsSync(path.join(selectedRoot, 'profile.yaml'))) {
      throw new ProfileValidationError(`Unknown profile "${id}". Available built-in profiles: ${this.list().map((profile) => profile.id).join(', ')}.`);
    }
    if (source === 'project-local' && id === 'base') {
      throw new ProfileValidationError('Project-local profiles cannot replace the protected "base" profile.');
    }
    const selected = this.loader.load(selectedRoot, source, id);
    if (selected.definition.extends && selected.definition.extends !== 'base') {
      throw new ProfileValidationError(`Profile "${id}" has unsupported parent "${selected.definition.extends}".`);
    }
    const base = selected.definition.extends
      ? this.loader.load(path.join(this.profilesRoot, 'base'), 'builtin', 'base')
      : undefined;
    return composeProfiles(base, selected);
  }

  private localProfilesRoot(): string | undefined {
    return this.projectRoot ? path.join(this.projectRoot, '.largentic', 'profiles') : undefined;
  }
}
