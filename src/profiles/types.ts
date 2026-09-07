export const AGENT_ROLES = ['planner', 'implementer', 'tester', 'reviewer'] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type ProfileSource = 'builtin' | 'project-local';

export interface DetectionEvidence {
  kind: 'artisan' | 'composer-dependency' | 'composer-manifest' | 'fallback';
  message: string;
  path?: string;
}

export interface DetectedRuntime {
  php?: string;
  laravel?: string;
}

export interface DetectionDefinition {
  indicators: string[];
}

export interface RuntimeConstraints {
  runtimes: Record<string, string>;
}

export interface ProfileCommands {
  package_manager?: string;
  [command: string]: string | undefined;
}

export interface ProfileContextPolicy {
  priority: string[];
  exclude: string[];
}

export interface ProfileDefinition {
  schema_version: 1;
  id: string;
  name: string;
  version: string;
  extends?: 'base';
  detection: DetectionDefinition;
  compatibility: RuntimeConstraints;
  commands: ProfileCommands;
  context: ProfileContextPolicy;
  rules: string[];
  agents: Record<AgentRole, string[]>;
}

export interface ResolvedProfileAsset {
  path: string;
  content: string;
  source: string;
}

export interface EffectiveProfile extends Omit<ProfileDefinition, 'rules' | 'agents'> {
  source: ProfileSource;
  rules: ResolvedProfileAsset[];
  agents: Record<AgentRole, ResolvedProfileAsset[]>;
  resolvedCommands: ProfileCommands;
  contentHash: string;
}

export interface ResolvedCommands {
  packageManager: string | null;
  test?: string;
  build?: string;
  lint?: string;
  typecheck?: string;
  sources: Partial<Record<'test' | 'build' | 'lint' | 'typecheck', 'project-override' | 'package-script' | 'profile-default' | 'framework-fallback'>>;
}
