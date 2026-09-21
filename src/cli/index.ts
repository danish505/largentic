#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { configValidateCommand, configShowCommand } from './commands/config.js';
import { runCommand } from './commands/run.js';
import { statusCommand, inspectCommand, cancelCommand } from './commands/status.js';
import { resumeCommand } from './commands/resume.js';
import { runsCommand } from './commands/runs.js';
import { reportCommand } from './commands/report.js';
import { profileApplyCommand, profileDetectCommand, profileDiffCommand, profileListCommand, profileRefreshCommand, profileShowCommand } from './commands/profile.js';
import { HARNESS_DIR_NAME, HARNESS_NAME_WITH_VERSION } from '../constants.js';

const cwd = process.cwd();

const program = new Command();

program
  .name('lh')
  .description(`${HARNESS_NAME_WITH_VERSION} — AI-powered software-engineering workflow`)
  .version('2.0.0-alpha.0');

program
  .command('init')
  .description(`Initialise ${HARNESS_NAME_WITH_VERSION} in the current project`)
  .option('--profile <id>', 'Use an explicit built-in or manually authored local profile')
  .action((options: { profile?: string }) => initCommand(cwd, options));

program
  .command('doctor')
  .description('Check environment prerequisites and configuration')
  .action(() => doctorCommand(cwd));

const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('validate')
  .description('Validate the current config file')
  .action(() => configValidateCommand(cwd));

configCmd
  .command('show')
  .description('Print the merged configuration')
  .action(() => configShowCommand(cwd));

const profileCmd = program.command('profile').description('Inspect and safely materialize profiles');

profileCmd.command('list').description('List built-in and project-local profiles').action(() => profileListCommand(cwd));
profileCmd.command('detect').description('Show built-in profile detection evidence').action(() => profileDetectCommand(cwd));
profileCmd.command('show [id]').description('Show the selected or named effective profile').action((id?: string) => profileShowCommand(cwd, id));
profileCmd.command('diff [id]').description('Preview Codex files that a profile would generate').action((id?: string) => profileDiffCommand(cwd, id));
profileCmd.command('apply <id>').description('Select and safely materialize a profile').option('--force', 'Back up and replace conflicting Codex files').action((id: string, options: { force?: boolean }) => profileApplyCommand(cwd, id, options));
profileCmd.command('refresh').description('Refresh only unmodified generated Codex files').option('--force', 'Back up and replace conflicting Codex files').action((options: { force?: boolean }) => profileRefreshCommand(cwd, options));

program
  .command('run [task]')
  .description(`Run the full four-stage workflow. Pass the task inline or define it in ${HARNESS_DIR_NAME}/task.md`)
  .option('--auto-approve', 'Skip interactive approval prompts (for scripting)')
  .option('--provider <name>', 'Override provider (codex | fake)')
  .option('--plan-file <path>', 'Path to a predefined plan file to jump directly to implementation')
  .action(async (task: string | undefined, opts: { autoApprove?: boolean; provider?: string; planFile?: string }) => {
    await runCommand(task, cwd, { autoApprove: opts.autoApprove, provider: opts.provider, planFile: opts.planFile });
  });

program
  .command('runs')
  .description('List recent valid runs')
  .option('--limit <n>', 'Maximum runs to show (default: 10)')
  .option('--status <status>', 'Filter by run status')
  .option('--latest', 'Show exactly the newest matching run')
  .action((opts: { limit?: string; status?: string; latest?: boolean }) => runsCommand(cwd, opts));

program
  .command('resume <run-id>')
  .description('Resume an existing non-terminal run in place')
  .option('--auto-approve', 'Skip approval prompts')
  .option('--provider <name>', 'Override provider (codex | fake)')
  .action(async (runId: string, opts: { autoApprove?: boolean; provider?: string }) => resumeCommand(runId, cwd, opts));

program
  .command('status [run-id]')
  .description('Show the current status of a run')
  .option('--latest', 'Select the newest valid run')
  .action((runId: string | undefined, opts: { latest?: boolean }) => statusCommand(runId, cwd, opts));

program
  .command('inspect [run-id]')
  .description('Print full manifest, state, and event log for a run')
  .option('--latest', 'Select the newest valid run')
  .action((runId: string | undefined, opts: { latest?: boolean }) => inspectCommand(runId, cwd, opts));

program
  .command('cancel <run-id>')
  .description('Cancel a running or paused run')
  .action((runId: string) => cancelCommand(runId, cwd));

program
  .command('report [run-id]')
  .description('Print a consolidated Markdown report for a run')
  .option('--latest', 'Select the newest valid run')
  .action((runId: string | undefined, opts: { latest?: boolean }) => reportCommand(runId, cwd, opts));

program.parse(process.argv);
