import * as fs from 'fs';
import type { RunStatus, Stage, GateResult } from '../types.js';

export type EventType =
  | 'state_transition'
  | 'stage_start'
  | 'stage_complete'
  | 'stage_failed'
  | 'agent_call_start'
  | 'agent_call_complete'
  | 'run_resumed'
  | 'review_rejection_notes'
  | 'command_exec'
  | 'gate_result'
  | 'approval_request'
  | 'approval_decision'
  | 'retry'
  | 'termination'
  | 'budget_check';

export interface HarnessEvent {
  type: EventType;
  run_id: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface AgentCallCompleteData {
  run_id: string;
  stage: Stage;
  attempt: number;
  status: 'success' | 'failure' | 'blocked';
  duration_ms: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface EventReadResult { events: HarnessEvent[]; malformedLines: number; }

export class EventLogger {
  private eventsFile: string;

  constructor(eventsFile: string) {
    this.eventsFile = eventsFile;
  }

  log(type: EventType, data: Record<string, unknown>): void {
    const event: HarnessEvent = {
      type,
      run_id: data['run_id'] as string ?? '',
      timestamp: new Date().toISOString(),
      ...data,
    };
    fs.appendFileSync(this.eventsFile, JSON.stringify(event) + '\n', 'utf8');
  }

  stateTransition(runId: string, from: RunStatus, to: RunStatus, actor: string): void {
    this.log('state_transition', { run_id: runId, from, to, actor });
  }

  stageStart(runId: string, stage: Stage, attempt: number): void {
    this.log('stage_start', { run_id: runId, stage, attempt });
  }

  stageComplete(runId: string, stage: Stage, attempt: number, summary: string): void {
    this.log('stage_complete', { run_id: runId, stage, attempt, summary });
  }

  stageFailed(runId: string, stage: Stage, attempt: number, classification: string, details: string): void {
    this.log('stage_failed', { run_id: runId, stage, attempt, classification, details });
  }

  agentCallComplete(data: AgentCallCompleteData): void {
    this.log('agent_call_complete', { ...data });
  }

  gateResult(runId: string, results: GateResult[]): void {
    this.log('gate_result', { run_id: runId, results });
  }

  approvalRequest(runId: string, stage: Stage): void {
    this.log('approval_request', { run_id: runId, stage });
  }

  approvalDecision(runId: string, decision: string, actor: string): void {
    this.log('approval_decision', { run_id: runId, decision, actor });
  }

  retry(runId: string, reason: string, attempt: number): void {
    this.log('retry', { run_id: runId, reason, attempt });
  }

  termination(runId: string, reason: string, finalStatus: RunStatus): void {
    this.log('termination', { run_id: runId, reason, final_status: finalStatus });
  }

  readAll(): HarnessEvent[] {
    return this.readWithDiagnostics().events;
  }

  readWithDiagnostics(): EventReadResult {
    if (!fs.existsSync(this.eventsFile)) return { events: [], malformedLines: 0 };
    let malformedLines = 0;
    const events = fs
      .readFileSync(this.eventsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line: string) => {
        try {
          const event = JSON.parse(line) as unknown;
          if (event && typeof event === 'object') return [event as HarnessEvent];
          malformedLines++;
          return [];
        } catch {
          malformedLines++;
          return [];
        }
      });
    return { events, malformedLines };
  }
}
