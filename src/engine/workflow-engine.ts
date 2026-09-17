import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentProvider,
  ApprovalDecision,
  HarnessConfig,
  Stage,
  StageResult,
  RunState,
} from '../types.js';
import { EventLogger } from '../telemetry/event-logger.js';
import { StateStore } from '../state/state-store.js';
import { RunLock } from '../state/run-lock.js';
import { clearCancellationRequest, isCancellationRequested } from '../state/cancellation-request.js';
import { ApprovalGate } from './approval-gate.js';
import {
  getNextStageStatus,
  isTerminal,
} from './state-machine.js';
import type { RunPaths } from './run-manager.js';
import type { ProgressReporter } from '../ui/progress-reporter.js';
import { HARNESS_NAME_WITH_VERSION } from '../constants.js';

export interface WorkflowEngineOptions {
  config: HarnessConfig;
  provider: AgentProvider;
  runId: string;
  paths: RunPaths;
  task: string;
  cwd: string;
  /** If true, auto-approve plan (skips interactive prompt). Used in tests. */
  autoApprove?: boolean;
  /** Optional live progress reporter — omit for silent/test mode. */
  reporter?: ProgressReporter;
  /** Optional approval gate override. Used in tests. */
  approvalGate?: ApprovalGate;
  /** Optional initial plan text to skip planning stage. */
  initialPlan?: string;
  /** Original status supplied by `lh resume`; logged only after the run lock is acquired. */
  resumedFromStatus?: RunState['status'];
  /** Restore the saved stage of a cooperatively cancelled run after locking it. */
  resumeCancelled?: boolean;
}

const STAGE_TO_ARTIFACT: Record<Stage, string> = {
  planning:     'plan.md',
  implementing: 'implementation.md',
  testing:      'test-results.md',
  reviewing:    'review.md',
};

const STAGE_TO_AGENT: Record<Stage, string> = {
  planning:     'planner',
  implementing: 'implementer',
  testing:      'tester',
  reviewing:    'reviewer',
};

export class WorkflowEngine {
  private opts: WorkflowEngineOptions;
  private store: StateStore;
  private lock: RunLock;
  private logger: EventLogger;
  private gate: ApprovalGate;

  constructor(opts: WorkflowEngineOptions) {
    this.opts   = opts;
    this.store  = new StateStore(opts.paths.runDir);
    this.lock   = new RunLock(opts.paths.runDir);
    this.logger = new EventLogger(opts.paths.eventsFile);
    this.gate   = opts.approvalGate ?? new ApprovalGate();
  }

  async run(): Promise<RunState> {
    this.lock.acquire();
    try {
      return await this.execute();
    } finally {
      this.lock.release();
    }
  }

  private async execute(): Promise<RunState> {
    const { config, provider, runId, task } = this.opts;
    let state = this.store.read();

    if (this.opts.resumeCancelled) {
      state = this.store.resumeCancelled();
      this.logger.stateTransition(runId, 'cancelled', state.status, 'human');
    }

    if (this.opts.resumedFromStatus) {
      this.logger.log('run_resumed', {
        run_id: runId,
        previous_status: this.opts.resumedFromStatus,
        actor: 'human',
      });
    }

    state = this.reconcileCompletedStage(state);
    if (isTerminal(state.status)) return state;
    const initialCancellation = this.cancelIfRequested(state);
    if (initialCancellation) return initialCancellation;

    if (state.status === 'awaiting_review_approval') {
      state = await this.finalizeReviewApproval();
      if (isTerminal(state.status)) return state;
      state = await this.planUntilApproved(state, provider, task, this.readArtifact('requested-changes.md'));
      if (isTerminal(state.status)) return state;
    }

    if (this.opts.initialPlan && state.status === 'created') {
      const planResult: StageResult = {
        schema_version: '2.0',
        run_id: runId,
        attempt: state.attempt + 1,
        stage: 'planning',
        status: 'success',
        agent_id: 'human',
        provider: 'manual',
        input_hashes: {},
        output_files: [],
        summary: 'Injected plan from file',
        content: this.opts.initialPlan,
        next_action: 'advance',
        failure_classification: null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };

      this.writeArtifact('planning', state, planResult);
      state = this.store.transition('implementing', { actor: 'human' });
    }

    // ── Planning ──────────────────────────────────────────────────────────────
    if (!['implementing', 'testing', 'testing_failed', 'reviewing'].includes(state.status)) {
      state = await this.planUntilApproved(state, provider, task);
      if (isTerminal(state.status)) return state;
    }

    // ── Implement → Test → Review repair loop ────────────────────────────────
    for (let attempt = state.attempt; attempt < config.workflow.max_attempts; attempt++) {
      const cancellationAtBoundary = this.cancelIfRequested(state);
      if (cancellationAtBoundary) return cancellationAtBoundary;

      // Implementing
      if (!['testing', 'testing_failed', 'reviewing', 'review_rejected'].includes(state.status)) {
        state = this.enterStage('implementing', state, runId);
        const implResult = await this.runStage('implementing', state, provider, task);
        this.writeArtifact('implementing', state, implResult);

        if (implResult.status !== 'success') {
          this.logger.stageFailed(runId, 'implementing', attempt + 1, implResult.failure_classification ?? 'unknown', implResult.failure_details ?? implResult.summary);
          if (attempt + 1 >= config.workflow.max_attempts) {
            state = this.store.transition('failed', { actor: 'system', failureReason: `Max attempts (${config.workflow.max_attempts}) reached at implementing` });
            this.logger.termination(runId, 'Max attempts reached at implementing', 'failed');
            return state;
          }
          this.logger.retry(runId, 'implementing failed', attempt + 2);
          this.opts.reporter?.retrying('implementing', attempt + 2);
          continue;
        }
        this.logger.stageComplete(runId, 'implementing', attempt + 1, implResult.summary);
        state = this.store.transition('testing', { actor: 'system' });
        const cancellation = this.cancelIfRequested(state);
        if (cancellation) return cancellation;
      }

      // Testing
      if (!['reviewing', 'review_rejected'].includes(state.status)) {
        state = this.enterStage('testing', state, runId);
        const testResult = await this.runStage('testing', state, provider, task);
        this.writeArtifact('testing', state, testResult);

        if (testResult.status !== 'success') {
          this.logger.stageFailed(runId, 'testing', attempt + 1, testResult.failure_classification ?? 'unknown', testResult.failure_details ?? testResult.summary);
          if (attempt + 1 >= config.workflow.max_attempts) {
            state = this.store.transition('testing_failed', { actor: 'tester' });
            state = this.store.transition('failed', { actor: 'system', failureReason: `Max attempts (${config.workflow.max_attempts}) reached at testing` });
            this.logger.termination(runId, 'Max attempts reached at testing', 'failed');
            return state;
          }
          this.logger.retry(runId, 'testing failed — retrying implementing', attempt + 2);
          this.opts.reporter?.retrying('testing', attempt + 2);
          state = this.store.transition('testing_failed', { actor: 'tester' });
          state = this.store.transition('implementing', { actor: 'system' });
          continue;
        }
        this.logger.stageComplete(runId, 'testing', attempt + 1, testResult.summary);
        state = this.store.transition('reviewing', { actor: 'system' });
        const cancellation = this.cancelIfRequested(state);
        if (cancellation) return cancellation;
      }

      // Reviewing
      state = this.enterStage('reviewing', state, runId);
      const reviewResult = await this.runStage('reviewing', state, provider, task);
      this.writeArtifact('reviewing', state, reviewResult);

      const reviewRequestedChanges = reviewResult.status === 'success' && requestsChanges(reviewResult.content);
      if (reviewResult.status !== 'success' || reviewRequestedChanges) {
        this.writeRequestedChanges(reviewResult.content);
        this.logger.stageFailed(runId, 'reviewing', attempt + 1, reviewResult.failure_classification ?? 'unknown', reviewResult.failure_details ?? reviewResult.summary);
        if (attempt + 1 >= config.workflow.max_attempts) {
          state = this.store.transition('review_rejected', { actor: 'reviewer' });
          state = this.store.transition('failed', { actor: 'system', failureReason: `Max attempts (${config.workflow.max_attempts}) reached at reviewing` });
          this.logger.termination(runId, 'Max attempts reached at reviewing', 'failed');
          return state;
        }
        this.logger.retry(runId, 'review rejected — replanning', attempt + 2);
        this.opts.reporter?.retrying('planning', attempt + 2);
        state = this.store.transition('review_rejected', { actor: 'reviewer' });
        state = await this.planUntilApproved(state, provider, task, reviewResult.content);
        if (isTerminal(state.status)) return state;
        continue;
      }

      this.logger.stageComplete(runId, 'reviewing', attempt + 1, reviewResult.summary);
      state = this.store.transition('awaiting_review_approval', { actor: 'reviewer' });
      const cancellationAfterReview = this.cancelIfRequested(state);
      if (cancellationAfterReview) return cancellationAfterReview;
      state = await this.finalizeReviewApproval();
      if (isTerminal(state.status)) return state;
      state = await this.planUntilApproved(state, provider, task, this.readArtifact('requested-changes.md'));
      if (isTerminal(state.status)) return state;
      continue;
    }

    // Should not reach here, but guard anyway
    if (!isTerminal(state.status)) {
      state = this.store.transition('failed', { actor: 'system', failureReason: 'Workflow loop exhausted' });
    }
    return state;
  }

  private async planUntilApproved(
    state: RunState,
    provider: AgentProvider,
    task: string,
    reviewFeedback?: string
  ): Promise<RunState> {
    const { config, runId } = this.opts;
    let previousPlan: string | undefined;
    let planUpdateNotes: string | undefined;

    while (true) {
      const cancellation = this.cancelIfRequested(state);
      if (cancellation) return cancellation;
      let currentPlan: string;
      if (state.status === 'awaiting_plan_approval') {
        currentPlan = this.readArtifact(STAGE_TO_ARTIFACT.planning);
      } else {
        state = this.enterStage('planning', state, runId);
        const planResult = await this.runStage('planning', state, provider, task, {
          previousPlan,
          planUpdateNotes,
          reviewFeedback,
        });

        if (planResult.status !== 'success') {
          state = this.store.transition('failed', { actor: 'planner', failureReason: planResult.failure_classification ?? 'planning failed' });
          this.logger.termination(runId, 'Planning failed', 'failed');
          return state;
        }

        this.writeArtifact('planning', state, planResult);
        this.logger.stageComplete(runId, 'planning', state.attempt + 1, planResult.summary);
        state = this.store.transition('awaiting_plan_approval', { actor: 'planner' });
        currentPlan = this.readArtifact(STAGE_TO_ARTIFACT.planning);
      }

      if (config.workflow.plan_approval !== 'required' || this.opts.autoApprove) {
        return this.store.transition('implementing', { actor: 'system' });
      }

      this.logger.approvalRequest(runId, 'planning');
      if (this.opts.reporter) {
        this.opts.reporter.approvalBanner(currentPlan);
      } else {
        process.stdout.write(`\n  ✋ Plan requires approval.\n`);
        process.stdout.write(`Plan:\n${'─'.repeat(60)}\n${currentPlan}\n${'─'.repeat(60)}\n`);
      }

      let decision: ApprovalDecision;
      while (true) {
        decision = await this.gate.requestApproval('');
        const cancellation = this.cancelIfRequested(this.store.read());
        if (cancellation) return cancellation;
        this.logger.approvalDecision(runId, decision, 'human');
        if (decision === 'exported') {
          const exported = await this.exportPlan(currentPlan);
          if (exported) process.stdout.write(`  ✓ Plan exported to ${exported}\n`);
          continue;
        }
        if (decision === 'update') {
          planUpdateNotes = await this.gate.requestPlanUpdate();
          if (!planUpdateNotes) {
            process.stdout.write(`  ⚠ No update notes provided. Prompting again...\n`);
            continue;
          }
          previousPlan = currentPlan;
        }
        break;
      }

      if (decision === 'update') {
        state = this.store.transition('planning', { actor: 'human' });
        continue;
      }
      if (decision !== 'approved') {
        state = this.store.transition('cancelled', { actor: 'human', failureReason: decision === 'rejected' ? 'Plan rejected by user' : 'User cancelled' });
        this.logger.termination(runId, `Plan ${decision} by user`, 'cancelled');
        return state;
      }
      return this.store.transition('implementing', { actor: 'system' });
    }
  }

  private async finalizeReviewApproval(): Promise<RunState> {
    const { config, runId } = this.opts;
    if (config.workflow.review_approval !== 'required' || this.opts.autoApprove) {
      return this.store.transition('approved', { actor: 'system' });
    }

    const review = this.readArtifact(STAGE_TO_ARTIFACT.reviewing);
    this.logger.approvalRequest(runId, 'reviewing');
    if (this.opts.reporter) {
      this.opts.reporter.finalReviewApprovalBanner(review);
    } else {
      process.stdout.write(`\n  ✋ Final review requires approval.\n`);
      process.stdout.write(`Review:\n${'─'.repeat(60)}\n${review}\n${'─'.repeat(60)}\n`);
    }

    const decision = await this.gate.requestFinalReviewApproval();
    const cancellation = this.cancelIfRequested(this.store.read());
    if (cancellation) return cancellation;
    this.logger.approvalDecision(runId, decision, 'human');
    if (decision === 'approved') {
      return this.store.transition('approved', { actor: 'human' });
    }
    if (decision === 'cancelled') {
      const cancelled = this.store.transition('cancelled', { actor: 'human', failureReason: 'Final review approval cancelled by user' });
      this.logger.termination(runId, 'Final review approval cancelled by user', 'cancelled');
      return cancelled;
    }

    const notes = await this.gate.requestFinalReviewRejection();
    const feedback = notes
      ? `${review}\n\n## Final approval feedback\n\n${notes}\n`
      : review;
    this.writeRequestedChanges(feedback);
    return this.store.transition('review_rejected', {
      actor: 'human',
      failureReason: notes || 'Final review rejected by user',
    });
  }

  private cancelIfRequested(state: RunState): RunState | null {
    if (!isCancellationRequested(this.opts.paths.runDir)) return null;

    clearCancellationRequest(this.opts.paths.runDir);
    const cancelled = this.store.transition('cancelled', {
      actor: 'human',
      failureReason: 'Cancellation requested by user',
      resumeStatus: state.status,
    });
    this.logger.termination(state.run_id, 'Cancellation request processed at a safe stage boundary', 'cancelled');
    return cancelled;
  }

  private enterStage(stage: Stage, state: RunState, runId: string): RunState {
    const enterStatus = stageToEnterStatus(stage);
    let next = state;
    if (state.status !== enterStatus) {
      next = this.store.transition(enterStatus, { actor: 'system' });
      this.logger.stateTransition(runId, state.status, enterStatus, 'system');
    }
    this.logger.stageStart(runId, stage, next.attempt + 1);
    this.opts.reporter?.stageStarted(stage, next.attempt + 1);
    return next;
  }

  private async runStage(
    stage: Stage,
    state: RunState,
    provider: AgentProvider,
    task: string,
    options?: { previousPlan?: string; planUpdateNotes?: string; reviewFeedback?: string }
  ): Promise<StageResult> {
    const started_at = new Date().toISOString();
    const attempt = state.attempt + 1;

    const systemPrompt = buildSystemPrompt({
      stage,
      agentName: STAGE_TO_AGENT[stage],
      runId: state.run_id,
      attempt,
      runDir: this.opts.paths.runDir,
      cwd: this.opts.cwd,
      config: this.opts.config,
      previousPlan: options?.previousPlan,
      planUpdateNotes: options?.planUpdateNotes,
      reviewFeedback: options?.reviewFeedback,
    });
    const userMessage  = buildUserMessage(stage, task, attempt, options);

    this.logger.log('agent_call_start', { run_id: state.run_id, stage, attempt: state.attempt + 1 });

    // Attach live event callback when provider supports it (CodexProvider)
    const reporter = this.opts.reporter;
    if (reporter && 'setOnEvent' in provider && typeof (provider as Record<string, unknown>).setOnEvent === 'function') {
      (provider as { setOnEvent: (cb: (e: unknown) => void) => void }).setOnEvent(
        (e) => reporter.codexEvent(e as Parameters<typeof reporter.codexEvent>[0])
      );
    }

    const agentResult = await provider.execute({
      stage,
      runId: state.run_id,
      attempt: state.attempt + 1,
      systemPrompt,
      userMessage,
      contextFiles: [],
    });

    this.logger.log('agent_call_complete', { run_id: state.run_id, stage, status: agentResult.status });

    if (agentResult.status === 'success') {
      reporter?.stageCompleted(stage);
    } else {
      reporter?.stageFailed(stage, agentResult.failureClassification ?? 'unknown');
    }

    return {
      schema_version: '2.0',
      run_id: state.run_id,
      attempt: state.attempt + 1,
      stage,
      status: agentResult.status,
      agent_id: stage,
      provider: this.opts.config.provider,
      input_hashes: {},
      output_files: [],
      summary: agentResult.content.slice(0, 200),
      content: agentResult.content,
      next_action: agentResult.status === 'success' ? 'advance' : 'retry',
      failure_classification: agentResult.failureClassification ?? null,
      failure_details: agentResult.status !== 'success' ? agentResult.content : undefined,
      usage: agentResult.usage
        ? {
            input_tokens: agentResult.usage.inputTokens,
            output_tokens: agentResult.usage.outputTokens,
            estimated_cost_usd: 0,
          }
        : undefined,
      started_at,
      completed_at: new Date().toISOString(),
    };
  }

  private handleFailure(state: RunState, stage: Stage, result: StageResult): RunState {
    const next = getNextStageStatus(
      stage === 'testing' ? 'testing' : stage === 'reviewing' ? 'reviewing' : 'implementing',
      result.status as 'failure' | 'blocked'
    );
    const newState = this.store.transition(next, {
      actor: stage,
      failureReason: result.failure_classification ?? undefined,
    });
    this.logger.stateTransition(state.run_id, state.status, next, stage);
    return newState;
  }

  private writeArtifact(stage: Stage, state: RunState, result: StageResult): void {
    const attemptDir = this.opts.paths.attemptDir(state.attempt + 1);
    fs.mkdirSync(attemptDir, { recursive: true });

    const artifactName = STAGE_TO_ARTIFACT[stage];
    const resultPath = this.checkpointPath(stage, state);
    this.writeAtomic(resultPath, JSON.stringify(result, null, 2));

    const artifactPath = path.join(attemptDir, artifactName);
    fs.writeFileSync(artifactPath, result.content, 'utf8');
    fs.writeFileSync(path.join(this.opts.paths.runDir, artifactName), result.content, 'utf8');
  }

  /**
   * A successful stage-result file is the durable completion checkpoint. It is
   * written before presentation artifacts, so recovery can restore artifacts
   * and advance state without invoking the provider a second time.
   */
  private reconcileCompletedStage(state: RunState): RunState {
    const stage = this.stageAwaitingRecovery(state.status);
    if (!stage) return state;

    const resultPath = this.checkpointPath(stage, state);
    if (!fs.existsSync(resultPath)) return state;

    let result: StageResult;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as StageResult;
    } catch {
      throw new Error(`Run ${state.run_id} has an unreadable ${stage} completion checkpoint.`);
    }

    if (result.run_id !== state.run_id || result.stage !== stage || result.attempt !== state.attempt + 1) {
      throw new Error(`Run ${state.run_id} has an inconsistent ${stage} completion checkpoint.`);
    }
    if (result.status !== 'success' || !result.content.trim()) return state;

    const artifactName = STAGE_TO_ARTIFACT[stage];
    const attemptArtifact = path.join(this.opts.paths.attemptDir(state.attempt + 1), artifactName);
    if (!fs.existsSync(attemptArtifact)) fs.writeFileSync(attemptArtifact, result.content, 'utf8');
    fs.writeFileSync(path.join(this.opts.paths.runDir, artifactName), result.content, 'utf8');

    const next = stage === 'reviewing' && requestsChanges(result.content)
      ? 'review_rejected'
      : getNextStageStatus(state.status, 'success');
    if (next === 'review_rejected') this.writeRequestedChanges(result.content);
    const recovered = this.store.transition(next, { actor: 'recovery' });
    this.logger.log('stage_checkpoint_recovered', {
      run_id: state.run_id,
      stage,
      attempt: result.attempt,
      from: state.status,
      to: next,
    });
    return recovered;
  }

  private stageAwaitingRecovery(status: RunState['status']): Stage | null {
    switch (status) {
      case 'planning': return 'planning';
      case 'implementing': return 'implementing';
      case 'testing': return 'testing';
      case 'reviewing': return 'reviewing';
      default: return null;
    }
  }

  private checkpointPath(stage: Stage, state: RunState): string {
    return path.join(this.opts.paths.attemptDir(state.attempt + 1), `${stage}-result.json`);
  }

  private writeAtomic(target: string, content: string): void {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, target);
  }

  private writeRequestedChanges(review: string): void {
    fs.writeFileSync(path.join(this.opts.paths.runDir, 'requested-changes.md'), review, 'utf8');
  }

  private readArtifact(filename: string): string {
    const p = path.join(this.opts.paths.runDir, filename);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(not found)';
  }

  private exportPlan(plan: string): string | null {
    const exportDirSetting = this.opts.config.workflow.plan_export_directory ?? '.largentic/exports';
    const exportDir = path.isAbsolute(exportDirSetting)
      ? exportDirSetting
      : path.join(this.opts.cwd, exportDirSetting);
    const exportPath = path.join(exportDir, `plan-${this.opts.runId}.md`);

    try {
      fs.mkdirSync(exportDir, { recursive: true });
      fs.writeFileSync(exportPath, plan, 'utf8');
      return exportPath;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`  ✗ Failed to export plan to ${exportPath}: ${msg}\n`);
      return null;
    }
  }

  private resolveStartStage(state: RunState): Stage {
    switch (state.status) {
      case 'created':
      case 'planning':
        return 'planning';
      case 'awaiting_plan_approval':
      case 'implementing':
        return 'implementing';
      case 'testing':
      case 'testing_failed':
        return 'testing';
      case 'reviewing':
      case 'review_rejected':
        return 'reviewing';
      default:
        return 'planning';
    }
  }
}

function stageToEnterStatus(stage: Stage): RunState['status'] {
  switch (stage) {
    case 'planning':     return 'planning';
    case 'implementing': return 'implementing';
    case 'testing':      return 'testing';
    case 'reviewing':    return 'reviewing';
  }
}

interface SystemPromptContext {
  stage: Stage;
  agentName: string;
  runId: string;
  attempt: number;
  runDir: string;
  cwd: string;
  config: HarnessConfig;
  previousPlan?: string;
  planUpdateNotes?: string;
  reviewFeedback?: string;
}

function buildSystemPrompt(ctx: SystemPromptContext): string {
  const { stage, agentName, runId, attempt, runDir, cwd, config, previousPlan, planUpdateNotes, reviewFeedback } = ctx;
  const artifactName = STAGE_TO_ARTIFACT[stage];
  const outputPath = path.join(runDir, artifactName);
  const globalRulesPath = path.join(cwd, '.codex', 'global-rules.md');
  const roleInstructionsPath = path.join(cwd, '.codex', 'agents', `${agentName}.toml`);
  const roleInstructions = readGeneratedRoleInstructions(roleInstructionsPath);
  const agentsMdPath = path.join(cwd, 'AGENTS.md');

  const inputArtifacts: string[] = [];
  if (stage === 'implementing') {
    inputArtifacts.push(path.join(runDir, 'plan.md'));
  }
  if (stage === 'testing') {
    inputArtifacts.push(path.join(runDir, 'plan.md'));
    inputArtifacts.push(path.join(runDir, 'implementation.md'));
  }
  if (stage === 'reviewing') {
    inputArtifacts.push(path.join(runDir, 'plan.md'));
    inputArtifacts.push(path.join(runDir, 'implementation.md'));
    inputArtifacts.push(path.join(runDir, 'test-results.md'));
  }
  if (stage === 'planning' && reviewFeedback) {
    inputArtifacts.push(path.join(runDir, 'requested-changes.md'));
  }

  const basePrompt = [
    `You are the ${agentName} agent for ${HARNESS_NAME_WITH_VERSION}.`,
    '',
    'Conductor context:',
    `- Stage: ${stage}`,
    `- Selected agent: ${agentName}`,
    `- Run ID: ${runId}`,
    `- Attempt: ${attempt}`,
    `- Run directory: ${runDir}`,
    `- Expected output artifact: ${outputPath}`,
    '',
    'Required reading:',
    `- ${globalRulesPath}`,
    agentsMdPath ? `- ${agentsMdPath}` : '',
    '',
    inputArtifacts.length > 0
      ? 'Required input artifacts:\n' + inputArtifacts.map((p) => `- ${p}`).join('\n')
      : '',
    '',
    'Return your stage artifact as the final Markdown response. The harness will write it to the run directory.',
  ];

  if (roleInstructions) {
    basePrompt.push(
      '',
      `Generated ${agentName} instructions (${roleInstructionsPath}):`,
      roleInstructions
    );
  }

  if (stage === 'planning' && previousPlan && planUpdateNotes) {
    basePrompt.push(
      '',
      'REVISION REQUEST:',
      'You are revising an existing plan based on user feedback. Make sure to keep the required sections and format, but update the strategies/details to address the user\'s requests/corrections.'
    );
  }

  const roleSpecific = getRoleSpecificInstructions(stage);

  const override = config.agents[agentName as keyof HarnessConfig['agents']]?.system_prompt_override;
  if (override) {
    basePrompt.push('', 'Task-specific guidance:', override);
  }

  return [...basePrompt, '', roleSpecific].filter(Boolean).join('\n');
}

function readGeneratedRoleInstructions(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  try {
    const source = fs.readFileSync(filePath, 'utf8');
    const match = source.match(/^developer_instructions\s*=\s*"""\r?\n([\s\S]*?)"""\s*$/m);
    return match?.[1].trim() || undefined;
  } catch {
    return undefined;
  }
}

function getRoleSpecificInstructions(stage: Stage): string {
  switch (stage) {
    case 'planning':
      return [
        'Produce a structured plan in Markdown with exactly these sections in this order:',
        '',
        '## Ask',
        'Restate the task in your own words. Confirm what is in scope and what is explicitly out of scope.',
        '',
        '## Assumptions',
        'List every assumption you are making about the codebase, environment, or requirements.',
        'Flag anything that could invalidate the plan if wrong.',
        '',
        '## Acceptance Criteria',
        'List concrete, testable criteria that must be true for this task to be considered done.',
        'Use checkbox format: `- [ ] criterion`',
        '',
        '## Implementation Strategy',
        'Describe the files, classes, and methods to create or change.',
        'List steps in execution order. Be specific enough for the implementer to act without guessing.',
        '',
        '## Test Strategy',
        'Describe what to test: unit tests, feature tests, edge cases.',
        'Specify the test command (e.g. `vendor/bin/phpunit --no-coverage --filter SomeTest`).',
        'Note any fakes or stubs needed.',
        '',
        'Do not include any text outside these five sections.',
        'Do not start implementing — output only the plan.',
      ].join('\n');

    case 'implementing':
      return [
        'Read the plan carefully and apply the smallest safe patch that satisfies all acceptance criteria.',
        'Check git status before editing. Do not touch unrelated dirty files.',
        'Write a brief implementation summary when done.',
      ].join('\n');

    case 'testing':
      return [
        'Run the tests specified in the plan\'s Test Strategy section.',
        'Report pass/fail with exact command output. Classify any failures clearly.',
      ].join('\n');

    case 'reviewing':
      return [
        'Review the implementation and test results against the plan\'s Acceptance Criteria.',
        'Use exactly one of these verdicts under a "## Verdict" heading: `APPROVE` or `REQUEST_CHANGES`.',
        'When requesting changes, add a "## Requested Changes" section with specific, actionable feedback. The harness will save it and send it to the planner for a new plan.',
      ].join('\n');
  }
}

function buildUserMessage(
  stage: Stage,
  task: string,
  attempt: number,
  options?: { previousPlan?: string; planUpdateNotes?: string; reviewFeedback?: string }
): string {
  const attemptNote = attempt > 1 ? `\n\nAttempt: ${attempt} (previous attempt failed — see failure details above)` : '';

  switch (stage) {
    case 'planning':
      if (options?.previousPlan && options?.planUpdateNotes) {
        return `Task: ${task}

We have already generated a plan, but the user requested changes/clarifications.

Previous Plan:
\`\`\`markdown
${options.previousPlan}
\`\`\`

User requested changes/clarifications:
${options.planUpdateNotes}

Please update the plan to incorporate these changes/clarifications. Maintain the exact same structure (Ask, Assumptions, Acceptance Criteria, Implementation Strategy, Test Strategy) and refine the strategy and criteria accordingly.`;
      }
      if (options?.reviewFeedback) {
        return `Task: ${task}\n\nThe reviewer requested changes. Read requested-changes.md in the run directory, revise the plan to address every actionable finding, and preserve only valid parts of the prior approach.\n\nReviewer feedback:\n\`\`\`markdown\n${options.reviewFeedback}\n\`\`\``;
      }
      return `Task: ${task}${attemptNote}`;

    default:
      return `Task: ${task}\n\nAttempt: ${attempt}`;
  }
}

function requestsChanges(content: string): boolean {
  return /^#{1,3}\s*Verdict\s*\n\s*(?:`)?REQUEST_CHANGES(?:`)?\s*$/im.test(content) ||
    /❌\s*REJECTED\b/i.test(content);
}
