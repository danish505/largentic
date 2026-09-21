import Ajv from 'ajv';
import * as fs from 'fs';
import * as path from 'path';
import type { ProfileDefinition } from './types.js';

const PROFILE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export class ProfileValidationError extends Error {}

export class ProfileValidator {
  private readonly validateSchema: ReturnType<Ajv['compile']>;

  constructor() {
    const schemaPath = path.resolve(__dirname, '../../schemas/profile.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    this.validateSchema = new Ajv({ allErrors: true }).compile(schema);
  }

  assertProfileId(id: string): void {
    if (!PROFILE_ID_PATTERN.test(id)) {
      throw new ProfileValidationError(
        `Invalid profile ID "${id}". Use lowercase letters, numbers, and hyphens; it must start with a letter.`
      );
    }
  }

  validateDefinition(value: unknown, profileRoot: string, expectedId?: string): ProfileDefinition {
    if (!this.validateSchema(value)) {
      const details = (this.validateSchema.errors ?? [])
        .map((error) => `${error.instancePath || '(root)'} ${error.message}`)
        .join('; ');
      throw new ProfileValidationError(`Invalid profile manifest: ${details}`);
    }

    const definition = value as ProfileDefinition;
    this.assertProfileId(definition.id);
    if (expectedId && definition.id !== expectedId) {
      throw new ProfileValidationError(
        `Profile manifest ID "${definition.id}" does not match requested profile "${expectedId}".`
      );
    }
    for (const asset of [...definition.rules, ...Object.values(definition.agents).flat()]) {
      this.resolveAssetPath(profileRoot, asset);
    }
    return definition;
  }

  resolveAssetPath(profileRoot: string, assetPath: string): string {
    if (!assetPath || path.isAbsolute(assetPath) || assetPath.split(/[\\/]+/).includes('..')) {
      throw new ProfileValidationError(`Profile asset path must stay within the profile: "${assetPath}".`);
    }

    const root = fs.realpathSync(profileRoot);
    const resolved = path.resolve(root, assetPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ProfileValidationError(`Profile asset path escapes the profile: "${assetPath}".`);
    }
    if (!fs.existsSync(resolved)) {
      throw new ProfileValidationError(`Profile asset does not exist: "${assetPath}".`);
    }

    const realAsset = fs.realpathSync(resolved);
    const realRelative = path.relative(root, realAsset);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new ProfileValidationError(`Profile asset symlink escapes the profile: "${assetPath}".`);
    }
    if (!fs.statSync(realAsset).isFile()) {
      throw new ProfileValidationError(`Profile asset must be a file: "${assetPath}".`);
    }
    return realAsset;
  }
}
