import type { EffectiveProfile } from './types.js';

/**
 * A conservative, tokenizer-agnostic estimate used to catch accidental profile
 * bloat before profile assets are passed to a future prompt composer.
 */
export const PROFILE_PROMPT_TOKEN_BUDGET = 3_000;

export interface ProfilePromptSize {
  characters: number;
  estimatedTokens: number;
}

export function measureProfilePromptSize(profile: EffectiveProfile): ProfilePromptSize {
  const content = [
    ...profile.rules.map((asset) => asset.content),
    ...Object.values(profile.agents).flat().map((asset) => asset.content),
  ].join('\n');
  return { characters: content.length, estimatedTokens: Math.ceil(content.length / 4) };
}
