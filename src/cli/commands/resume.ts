import { RunManager } from '../../engine/run-manager.js';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { loadConfig, findConfigPath } from '../../config/loader.js';
import { createProvider, resolveProviderName } from './run.js';
import { getCodexCliAvailabilityError } from '../../providers/codex-cli.js';
import { getCodexProjectConfigError } from '../../providers/codex-preflight.js';
import { ProgressReporter } from '../../ui/progress-reporter.js';
import { Spinner } from '../../ui/spinner.js';
import { isTerminal } from '../../engine/state-machine.js';
import { statusToExitCode } from '../exit-codes.js';

export async function resumeCommand(runId: string, cwd: string, options: { autoApprove?: boolean; provider?: string } = {}): Promise<void> {
  try {
    const loaded = new RunManager(cwd).load(runId);
    if (isTerminal(loaded.state.status)) throw new Error(`Run ${runId} is terminal (${loaded.state.status}) and cannot be resumed.`);
    const { config, valid, errors } = loadConfig(findConfigPath(cwd));
    if (!valid) throw new Error(`Invalid config:\n${errors.join('\n')}`);
    const providerName = resolveProviderName(loaded.manifest.provider as typeof config.provider, options.provider);
    if (!providerName) throw new Error(`Unsupported provider "${options.provider}". Use "codex" or "fake".`);
    if (providerName === 'codex') {
      const availability = getCodexCliAvailabilityError(cwd);
      if (availability) throw new Error(availability);
      const preflight = getCodexProjectConfigError(cwd);
      if (preflight) throw new Error(preflight);
    }
    const finalState = await new WorkflowEngine({ config: { ...config, provider: providerName }, provider: createProvider(providerName, cwd), runId, paths: loaded.paths, task: loaded.manifest.task, cwd, autoApprove: options.autoApprove, reporter: new ProgressReporter(new Spinner(process.stdout.isTTY)), resumedFromStatus: loaded.state.status }).run();
    process.exitCode = statusToExitCode(finalState.status);
  } catch (error: unknown) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 6;
  }
}
