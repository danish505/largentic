import * as fs from 'fs';
import * as path from 'path';
import { RunManager } from '../../engine/run-manager.js';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { isTerminal } from '../../engine/state-machine.js';
import { getCodexCliAvailabilityError } from '../../providers/codex-cli.js';
import { getCodexProjectConfigError } from '../../providers/codex-preflight.js';
import { loadConfig, findConfigPath } from '../../config/loader.js';
import { ProgressReporter } from '../../ui/progress-reporter.js';
import { Spinner } from '../../ui/spinner.js';
import { statusToExitCode } from '../exit-codes.js';
import { createProvider, resolveProviderName } from '../provider-support.js';
import type { HarnessConfig, RunState } from '../../types.js';
import { ensureProjectMemory } from '../../project-memory.js';
import { tryWriteCycleSummary } from '../../engine/cycle-summary.js';

const REQUIRED_ARTIFACTS: Partial<Record<RunState['status'], string[]>> = {
  awaiting_plan_approval: ['plan.md'],
  implementing: ['plan.md'],
  testing: ['plan.md', 'implementation.md'],
  testing_failed: ['plan.md', 'implementation.md'],
  reviewing: ['plan.md', 'implementation.md', 'test-results.md'],
  awaiting_review_approval: ['plan.md', 'implementation.md', 'test-results.md', 'review.md'],
  review_rejected: ['plan.md', 'implementation.md', 'test-results.md', 'review.md'],
};

export async function resumeCommand(
  runId: string,
  cwd: string,
  options: { autoApprove?: boolean; provider?: string } = {}
): Promise<void> {
  try {
    const manager = new RunManager(cwd);
    const { paths, manifest, state } = manager.loadExisting(runId);

    const isCooperativelyCancelled = state.status === 'cancelled' && Boolean(state.resume_status);
    if (isTerminal(state.status) && !isCooperativelyCancelled) {
      throw new Error(`Run ${runId} is already in terminal state: ${state.status}.`);
    }
    const resumeState = isCooperativelyCancelled ? { ...state, status: state.resume_status! } : state;
    assertPrerequisiteArtifacts(paths.runDir, resumeState);

    const { config, valid, errors } = loadConfig(findConfigPath(cwd));
    if (!valid) {
      console.error('❌ Invalid config:\n' + errors.join('\n'));
      process.exitCode = 5;
      return;
    }

    const providerName = resolveProviderName(manifest.provider as HarnessConfig['provider'], options.provider);
    if (!providerName) {
      console.error(`❌ Unsupported provider "${options.provider}". Use "codex" or "fake".`);
      process.exitCode = 5;
      return;
    }

    if (providerName === 'codex') {
      const codexError = getCodexCliAvailabilityError(cwd);
      if (codexError) throw new Error(codexError);
      const configError = getCodexProjectConfigError(cwd);
      if (configError) throw new Error(`Native-agent mode cannot start.\n${configError}`);
    }

    console.log(`\n⏩ Resuming run ${runId} from ${resumeState.status}.`);
    ensureProjectMemory(cwd);
    const engine = new WorkflowEngine({
      config: { ...config, provider: providerName },
      provider: createProvider(providerName, cwd),
      runId,
      paths,
      task: manifest.task,
      cwd,
      autoApprove: options.autoApprove,
      reporter: new ProgressReporter(new Spinner(process.stdout.isTTY)),
      resumedFromStatus: resumeState.status,
      resumeCancelled: isCooperativelyCancelled,
    });

    const finalState = await engine.run();
    const cycleSummary = tryWriteCycleSummary({ paths, task: manifest.task, state: finalState });
    console.log(`\n${finalState.status === 'approved' ? '✅' : '⏹'} Run ${finalState.status.toUpperCase()}`);
    console.log(`   Run ID: ${runId}`);
    if (finalState.failure_reason) console.log(`   Reason: ${finalState.failure_reason}`);
    if (cycleSummary.summary) console.log(`\n${cycleSummary.summary}`);
    if (cycleSummary.error) console.warn(`⚠ Run completed, but its summary could not be written: ${cycleSummary.error}`);
    process.exitCode = statusToExitCode(finalState.status);
  } catch (error: unknown) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 6;
  }
}

function assertPrerequisiteArtifacts(runDir: string, state: RunState): void {
  const missing = (REQUIRED_ARTIFACTS[state.status] ?? []).filter((filename) => {
    const artifact = path.join(runDir, filename);
    return !fs.existsSync(artifact) || !fs.readFileSync(artifact, 'utf8').trim();
  });
  if (missing.length > 0) {
    throw new Error(`Run ${state.run_id} cannot resume from ${state.status}: missing required artifact(s): ${missing.join(', ')}.`);
  }
}
