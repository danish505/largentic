import { createHash } from 'crypto';
import type { EffectiveProfile, ProfileDefinition } from './types.js';
import type { LoadedProfile } from './loader.js';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function composeProfiles(base: LoadedProfile | undefined, selected: LoadedProfile): EffectiveProfile {
  const baseDefinition = base?.definition;
  const definition: Omit<ProfileDefinition, 'rules' | 'agents'> = {
    ...selected.definition,
    compatibility: { runtimes: { ...(baseDefinition?.compatibility.runtimes ?? {}), ...selected.definition.compatibility.runtimes } },
    commands: { ...(baseDefinition?.commands ?? {}), ...selected.definition.commands },
    context: {
      priority: unique([...(baseDefinition?.context.priority ?? []), ...selected.definition.context.priority]),
      exclude: unique([...(baseDefinition?.context.exclude ?? []), ...selected.definition.context.exclude]),
    },
  };
  const effective: Omit<EffectiveProfile, 'contentHash'> = {
    ...definition,
    source: selected.source,
    rules: [...(base?.rules ?? []), ...selected.rules],
    agents: {
      planner: [...(base?.agents.planner ?? []), ...selected.agents.planner],
      implementer: [...(base?.agents.implementer ?? []), ...selected.agents.implementer],
      tester: [...(base?.agents.tester ?? []), ...selected.agents.tester],
      reviewer: [...(base?.agents.reviewer ?? []), ...selected.agents.reviewer],
    },
    resolvedCommands: { ...(baseDefinition?.commands ?? {}), ...selected.definition.commands },
  };
  return { ...effective, contentHash: createHash('sha256').update(stableJson(effective)).digest('hex') };
}
