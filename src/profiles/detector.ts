import * as fs from 'fs';
import * as path from 'path';
import type { DetectedRuntime, DetectionEvidence } from './types.js';

export interface DetectionResult {
  profile: 'laravel' | 'generic';
  projectRoot: string;
  hints: string[];
  evidence: DetectionEvidence[];
  runtime: DetectedRuntime;
}

export function detectProfile(cwd: string): DetectionResult {
  const hints: string[] = [];
  const evidence: DetectionEvidence[] = [];
  const runtime: DetectedRuntime = {};

  const artisan = path.join(cwd, 'artisan');
  const composerJson = path.join(cwd, 'composer.json');

  if (fs.existsSync(artisan)) {
    const message = 'Found artisan binary → Laravel project';
    hints.push(message);
    evidence.push({ kind: 'artisan', message, path: 'artisan' });
    inspectComposer(composerJson, runtime, evidence, hints);
    return { profile: 'laravel', projectRoot: cwd, hints, evidence, runtime };
  }

  if (fs.existsSync(composerJson)) {
    try {
      const composer = JSON.parse(fs.readFileSync(composerJson, 'utf8')) as {
        require?: Record<string, string>;
      };
      if (composer.require?.['laravel/framework']) {
        runtime.laravel = composer.require['laravel/framework'];
        runtime.php = composer.require.php;
        const message = 'Found laravel/framework in composer.json → Laravel project';
        hints.push(message);
        evidence.push({ kind: 'composer-dependency', message, path: 'composer.json' });
        inspectComposerLock(cwd, runtime);
        return { profile: 'laravel', projectRoot: cwd, hints, evidence, runtime };
      }
      const message = 'Found composer.json without laravel/framework → generic PHP project';
      hints.push(message);
      evidence.push({ kind: 'composer-manifest', message, path: 'composer.json' });
    } catch {
      const message = 'Found composer.json (unparseable) → generic profile';
      hints.push(message);
      evidence.push({ kind: 'composer-manifest', message, path: 'composer.json' });
    }
  }

  const message = 'No Laravel indicators found → generic profile';
  hints.push(message);
  evidence.push({ kind: 'fallback', message });
  return { profile: 'generic', projectRoot: cwd, hints, evidence, runtime };
}

function inspectComposer(composerPath: string, runtime: DetectedRuntime, evidence: DetectionEvidence[], hints: string[]): void {
  if (!fs.existsSync(composerPath)) return;
  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, 'utf8')) as { require?: Record<string, string> };
    runtime.php = composer.require?.php;
    runtime.laravel = composer.require?.['laravel/framework'];
    if (runtime.laravel) {
      const message = 'Found laravel/framework in composer.json';
      hints.push(message);
      evidence.push({ kind: 'composer-dependency', message, path: 'composer.json' });
    }
    inspectComposerLock(path.dirname(composerPath), runtime);
  } catch {
    // The artisan indicator is sufficient; a malformed manifest only omits runtime metadata.
  }
}

function inspectComposerLock(cwd: string, runtime: DetectedRuntime): void {
  const lockPath = path.join(cwd, 'composer.lock');
  if (!fs.existsSync(lockPath)) return;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { packages?: Array<{ name?: string; version?: string }> };
    const framework = lock.packages?.find((pkg) => pkg.name === 'laravel/framework');
    if (framework?.version) runtime.laravel = framework.version;
  } catch {
    // Lockfile metadata is optional and never changes detection.
  }
}
