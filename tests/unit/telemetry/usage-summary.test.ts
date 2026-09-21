import { describe, expect, it } from 'vitest';
import { summarizeUsage } from '../../../src/telemetry/usage-summary.js';
import type { HarnessEvent } from '../../../src/telemetry/event-logger.js';

describe('summarizeUsage', () => {
  it('preserves explicit zero and marks partial calls unavailable', () => {
    const events = [
      { type: 'agent_call_complete', run_id: 'run', timestamp: '2026-01-01T00:00:00.000Z', stage: 'planning', attempt: 1, status: 'success', input_tokens: 0, output_tokens: 3 },
      { type: 'agent_call_complete', run_id: 'run', timestamp: '2026-01-01T00:00:01.000Z', stage: 'testing', attempt: 1, status: 'success', input_tokens: 2 },
    ] as HarnessEvent[];
    const summary = summarizeUsage(events);
    expect(summary.stages.planning.inputTokens).toBe(0);
    expect(summary.stages.testing.unavailableOutputCalls).toBe(1);
    expect(summary.totalOutputTokens).toBeUndefined();
  });
});
