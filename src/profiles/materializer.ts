import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { HARNESS_DIR_NAME } from '../constants.js';
import { AGENT_ROLES, type AgentRole, type EffectiveProfile } from './types.js';

const MANIFEST_VERSION = 1;
type MaterializationMode = 'apply' | 'refresh';

export interface GeneratedFilesManifest {
  schema_version: 1;
  profile_id: string;
  profile_hash: string;
  files: Record<string, { content_hash: string }>;
}

export interface MaterializationChange {
  path: string;
  action: 'create' | 'update' | 'unchanged' | 'conflict';
  reason?: string;
}

export interface MaterializationResult {
  changes: MaterializationChange[];
  conflicts: MaterializationChange[];
}

export function renderCodexFiles(profile: EffectiveProfile): Record<string, string> {
  const files: Record<string, string> = {
    '.codex/config.toml': renderCodexConfig(),
    '.codex/global-rules.md': renderGlobalRules(profile),
  };
  for (const role of AGENT_ROLES) {
    files[`.codex/agents/${role}.toml`] = renderAgent(role, profile);
  }
  return files;
}

export function previewCodexMaterialization(
  cwd: string,
  profile: EffectiveProfile,
  mode: MaterializationMode = 'apply'
): MaterializationResult {
  const existing = readGeneratedFilesManifest(cwd);
  const files = renderCodexFiles(profile);
  const changes = Object.entries(files).map(([relativePath, content]) => materializationChange(cwd, relativePath, content, existing, mode));
  return { changes, conflicts: changes.filter((change) => change.action === 'conflict') };
}

export function applyCodexMaterialization(
  cwd: string,
  profile: EffectiveProfile,
  options: { force?: boolean; mode?: MaterializationMode } = {}
): MaterializationResult {
  const mode = options.mode ?? 'apply';
  const preview = previewCodexMaterialization(cwd, profile, mode);

  const files = renderCodexFiles(profile);
  for (const change of preview.changes) {
    if (change.action === 'unchanged') continue;
    if (change.action === 'conflict' && !options.force) continue;
    const target = path.join(cwd, change.path);
    if (change.action === 'conflict' && options.force && fs.existsSync(target)) backupFile(target);
    if (change.action === 'conflict' && mode === 'refresh' && !fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, files[change.path], 'utf8');
  }

  const managedFiles = managedFilesFor(cwd, files);
  writeGeneratedFilesManifest(cwd, { schema_version: MANIFEST_VERSION, profile_id: profile.id, profile_hash: profile.contentHash, files: managedFiles });
  return preview;
}

export function readGeneratedFilesManifest(cwd: string): GeneratedFilesManifest | undefined {
  const manifestPath = path.join(cwd, HARNESS_DIR_NAME, 'generated-files.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as GeneratedFilesManifest;
    return parsed.schema_version === MANIFEST_VERSION && parsed.files ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeGeneratedFilesManifest(cwd: string, manifest: GeneratedFilesManifest): void {
  const manifestPath = path.join(cwd, HARNESS_DIR_NAME, 'generated-files.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function renderCodexConfig(): string {
  return `approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n\n[agents]\nmax_threads = 4\nmax_depth = 1\njob_max_runtime_seconds = 1800\n\n[agents.planner]\nconfig_file = "agents/planner.toml"\n\n[agents.implementer]\nconfig_file = "agents/implementer.toml"\n\n[agents.tester]\nconfig_file = "agents/tester.toml"\n\n[agents.reviewer]\nconfig_file = "agents/reviewer.toml"\n`;
}

function renderGlobalRules(profile: EffectiveProfile): string {
  const body = profile.rules.map((asset) => `<!-- ${asset.source}: ${asset.path} -->\n${asset.content.trim()}`).join('\n\n');
  return `# Largentic profile: ${profile.id}\n# Profile hash: ${profile.contentHash}\n\n${body}\n`;
}

function renderAgent(role: AgentRole, profile: EffectiveProfile): string {
  const instructions = profile.agents[role]
    .map((asset) => `[${asset.source}: ${asset.path}]\n${asset.content.trim()}`)
    .join('\n\n');
  const developerInstructions = `Read .codex/global-rules.md before starting.\n\n${instructions}\n`;
  return `name = ${JSON.stringify(role)}\ndescription = ${JSON.stringify(`${role} instructions generated from the ${profile.id} profile.`)}\nsandbox_mode = ${JSON.stringify(isReadOnlyRole(role) ? 'read-only' : 'workspace-write')}\ndeveloper_instructions = ${renderTomlMultilineString(developerInstructions)}\n`;
}

function renderTomlMultilineString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
  return `"""\n${escaped}"""`;
}

function materializationChange(
  cwd: string,
  relativePath: string,
  content: string,
  existing: GeneratedFilesManifest | undefined,
  mode: MaterializationMode
): MaterializationChange {
  const target = path.join(cwd, relativePath);
  if (!fs.existsSync(target)) {
    return mode === 'refresh'
      ? { path: relativePath, action: 'conflict', reason: 'managed file is missing' }
      : { path: relativePath, action: 'create' };
  }
  if (fs.readFileSync(target, 'utf8') === content) return { path: relativePath, action: 'unchanged' };
  const recorded = existing?.files[relativePath];
  if (recorded && hashFile(target) === recorded.content_hash) return { path: relativePath, action: 'update' };
  return { path: relativePath, action: 'conflict', reason: recorded ? 'file was changed outside Largentic' : 'file is not managed by Largentic' };
}

function managedFilesFor(cwd: string, files: Record<string, string>): GeneratedFilesManifest['files'] {
  return Object.entries(files).reduce<GeneratedFilesManifest['files']>((managedFiles, [relativePath, content]) => {
    const target = path.join(cwd, relativePath);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) {
      managedFiles[relativePath] = { content_hash: hashFile(target) };
    }
    return managedFiles;
  }, {});
}

function isReadOnlyRole(role: AgentRole): boolean {
  return role === 'planner' || role === 'reviewer';
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function backupFile(filePath: string): void {
  const backup = `${filePath}.largentic-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(filePath, backup, fs.constants.COPYFILE_EXCL);
}
