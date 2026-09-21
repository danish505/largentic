import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cache = mkdtempSync(path.join(os.tmpdir(), 'lh-npm-cache-'));
const artifacts = mkdtempSync(path.join(os.tmpdir(), 'lh-package-artifacts-'));
const required = [
  'profiles/base/profile.yaml',
  'profiles/generic/profile.yaml',
  'profiles/laravel/profile.yaml',
  'schemas/config.schema.json',
  'schemas/profile.schema.json',
  'dist/profiles/registry.js',
  'dist/profiles/materializer.js',
];

try {
  const output = execFileSync('npm', ['--cache', cache, 'pack', '--ignore-scripts', '--dry-run=false', '--json', '--pack-destination', artifacts], { encoding: 'utf8' });
  const packages = JSON.parse(output);
  const files = new Set(packages[0]?.files?.map((file) => file.path) ?? []);
  const missing = required.filter((file) => !files.has(file));
  if (missing.length > 0) throw new Error(`Package is missing required files: ${missing.join(', ')}`);
  const archive = path.join(artifacts, packages[0].filename);
  execFileSync('tar', ['-xzf', archive, '-C', artifacts]);
  const registry = path.join(artifacts, 'package', 'dist', 'profiles', 'registry.js');
  const resolved = execFileSync(process.execPath, ['-e', 'const { ProfileRegistry } = require(process.argv[1]); console.log(new ProfileRegistry().list().map((profile) => profile.id).join(","));', registry], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: path.resolve('node_modules') },
  }).trim();
  if (resolved !== 'base,generic,laravel') throw new Error(`Packaged registry did not resolve built-ins: ${resolved}`);
  console.log(`Package contents and packaged profile registry verified (${files.size} files).`);
} finally {
  rmSync(cache, { recursive: true, force: true });
  rmSync(artifacts, { recursive: true, force: true });
}
