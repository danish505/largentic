import type { Stage } from '../types.js';
import type { HarnessEvent } from './event-logger.js';

export interface StageUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  unavailableInputCalls: number;
  unavailableOutputCalls: number;
  unavailableCalls: number;
}

export interface UsageSummary {
  stages: Record<Stage, StageUsageSummary>;
  totalInputTokens: number | undefined;
  totalOutputTokens: number | undefined;
  unavailableCalls: number;
  overheadTokens: number;
}

const STAGES: Stage[] = ['planning', 'implementing', 'testing', 'reviewing'];

export function summarizeUsage(events: HarnessEvent[]): UsageSummary {
  const stages = Object.fromEntries(STAGES.map((stage) => [stage, { calls: 0, inputTokens: 0, outputTokens: 0, unavailableCalls: 0, unavailableInputCalls: 0, unavailableOutputCalls: 0 }])) as Record<Stage, StageUsageSummary>;
  let overheadTokens = 0;
  const seenSuccessful = new Set<Stage>();

  for (const event of events) {
    if (event.type !== 'agent_call_complete' || !isStage(event.stage)) continue;
    const stage = event.stage;
    const summary = stages[stage];
    summary.calls++;
    const input = number(event.input_tokens);
    const output = number(event.output_tokens);
    if (input === undefined) summary.unavailableInputCalls++;
    else summary.inputTokens += input;
    if (output === undefined) summary.unavailableOutputCalls++;
    else summary.outputTokens += output;
    if (input === undefined || output === undefined) summary.unavailableCalls++;
    else if (seenSuccessful.has(stage) || event.attempt !== 1) overheadTokens += input + output;
    if (event.status === 'success') seenSuccessful.add(stage);
  }

  return {
    stages,
    totalInputTokens: STAGES.some((stage) => stages[stage].unavailableInputCalls > 0) ? undefined : STAGES.reduce((sum, stage) => sum + stages[stage].inputTokens, 0),
    totalOutputTokens: STAGES.some((stage) => stages[stage].unavailableOutputCalls > 0) ? undefined : STAGES.reduce((sum, stage) => sum + stages[stage].outputTokens, 0),
    unavailableCalls: STAGES.reduce((sum, stage) => sum + stages[stage].unavailableCalls, 0),
    overheadTokens,
  };
}

function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && STAGES.includes(value as Stage);
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
