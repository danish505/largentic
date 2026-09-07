import { describe, expect, it } from 'vitest';
import { PROFILE_PROMPT_TOKEN_BUDGET, measureProfilePromptSize } from '../../../src/profiles/size-budget.js';
import { ProfileRegistry } from '../../../src/profiles/registry.js';

describe('profile prompt-size budget', () => {
  it.each(['generic', 'laravel'])('%s remains within the profile prompt budget', (id) => {
    const size = measureProfilePromptSize(new ProfileRegistry().resolve(id));
    expect(size.estimatedTokens).toBeLessThanOrEqual(PROFILE_PROMPT_TOKEN_BUDGET);
  });
});
