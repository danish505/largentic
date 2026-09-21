import * as fs from 'fs';
import { RunManager } from '../../engine/run-manager.js';
import { EventLogger } from '../../telemetry/event-logger.js';
import { HARNESS_NAME_WITH_VERSION } from '../../constants.js';
import { resolveRunId } from './runs.js';
import { summarizeUsage } from '../../telemetry/usage-summary.js';

export function reportCommand(runId: string | undefined, cwd: string, options: { latest?: boolean } = {}): void {
  const manager = new RunManager(cwd);
  try {
    const selection = resolveRunId(manager, runId, options);
    selection.warnings.forEach((warning) => console.error(`⚠ ${warning}`));
    const selectedRunId = selection.runId;
    const { runDir, paths, manifest, state } = manager.load(selectedRunId);
    const logger   = new EventLogger(paths.eventsFile);
    const eventRead = logger.readWithDiagnostics();
    const events   = eventRead.events;
    const usage = summarizeUsage(events);

    const startedAt  = new Date(manifest.created_at);
    const updatedAt  = new Date(state.updated_at);
    const elapsedMin = ((updatedAt.getTime() - startedAt.getTime()) / 60000).toFixed(1);

    const stageEvents = events.filter((e) =>
      ['stage_complete', 'stage_failed'].includes(e.type)
    );

    const artifactFiles = ['plan.md', 'implementation.md', 'test-results.md', 'review.md'];
    const artifacts = artifactFiles
      .filter((f) => fs.existsSync(require('path').join(runDir, f)))
      .map((f) => `  - ${f}`);

    const report = [
      `# ${HARNESS_NAME_WITH_VERSION} — Run Report`,
      ``,
      `**Run ID:** ${selectedRunId}`,
      `**Task:** ${manifest.task}`,
      `**Status:** ${state.status.toUpperCase()}`,
      `**Profile:** ${manifest.profile}`,
      `**Provider:** ${manifest.provider}`,
      `**Branch:** ${manifest.git_branch ?? 'unknown'}`,
      `**Commit:** ${manifest.git_commit ?? 'unknown'}`,
      `**Started:** ${manifest.created_at}`,
      `**Elapsed:** ${elapsedMin} min`,
      ``,
      `## Timeline`,
      ...stageEvents.map(
        (e) => `- [${e['timestamp']}] ${e.type}: stage=${e['stage']} attempt=${e['attempt']}`
      ),
      ``,
      `## Artifacts Produced`,
      ...artifacts,
      ``,
      `## Token Usage`,
      ...Object.entries(usage.stages).map(([stage, item]) => `- ${stage}: ${item.calls} calls, input ${item.unavailableInputCalls ? 'unavailable' : item.inputTokens}, output ${item.unavailableOutputCalls ? 'unavailable' : item.outputTokens}, total ${item.unavailableCalls ? 'unavailable' : item.inputTokens + item.outputTokens}`),
      `- Total known tokens: ${usage.totalInputTokens === undefined || usage.totalOutputTokens === undefined ? 'unavailable' : usage.totalInputTokens + usage.totalOutputTokens}`,
      `- Retry/revision overhead: ${usage.overheadTokens} tokens (calls after the first attempt or successful call for each stage)`,
      `- Calls without complete usage: ${usage.unavailableCalls}`,
      ...(eventRead.malformedLines ? [`- Warning: ignored ${eventRead.malformedLines} malformed event line(s).`] : []),
      ``,
      `## Final State`,
      `\`\`\`json`,
      JSON.stringify(state, null, 2),
      `\`\`\``,
      ``,
    ].join('\n');

    console.log(report);
  } catch (e: unknown) {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
