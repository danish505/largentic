import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProfileDefinition, ProfileSource, ResolvedProfileAsset } from './types.js';
import { ProfileValidationError, ProfileValidator } from './validator.js';

export interface LoadedProfile {
  definition: ProfileDefinition;
  source: ProfileSource;
  root: string;
  rules: ResolvedProfileAsset[];
  agents: Record<'planner' | 'implementer' | 'tester' | 'reviewer', ResolvedProfileAsset[]>;
}

export class ProfileLoader {
  constructor(private readonly validator = new ProfileValidator()) {}

  load(profileRoot: string, source: ProfileSource, expectedId?: string): LoadedProfile {
    const manifestPath = path.join(profileRoot, 'profile.yaml');
    if (!fs.existsSync(manifestPath)) {
      throw new ProfileValidationError(`Profile manifest not found: ${manifestPath}`);
    }
    let raw: unknown;
    try {
      raw = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProfileValidationError(`Could not parse profile manifest ${manifestPath}: ${message}`);
    }
    const definition = this.validator.validateDefinition(raw, profileRoot, expectedId);
    const loadAsset = (assetPath: string): ResolvedProfileAsset => {
      const resolved = this.validator.resolveAssetPath(profileRoot, assetPath);
      return { path: assetPath, content: fs.readFileSync(resolved, 'utf8'), source: definition.id };
    };
    return {
      definition,
      source,
      root: fs.realpathSync(profileRoot),
      rules: definition.rules.map(loadAsset),
      agents: {
        planner: definition.agents.planner.map(loadAsset),
        implementer: definition.agents.implementer.map(loadAsset),
        tester: definition.agents.tester.map(loadAsset),
        reviewer: definition.agents.reviewer.map(loadAsset),
      },
    };
  }
}
