import * as fs from 'fs';
import * as path from 'path';
import { detectProfile } from '../../profiles/detector.js';
import { HARNESS_DIR_NAME, HARNESS_NAME_WITH_VERSION } from '../../constants.js';
import { applyCodexMaterialization } from '../../profiles/materializer.js';
import { createProjectProfileRegistry } from '../../profiles/registry.js';
import { ensureProjectMemory } from '../../project-memory.js';

const CONFIG_TEMPLATE = `# ${HARNESS_NAME_WITH_VERSION} Configuration
# https://github.com/danish505/OpenHarness
version: 2

# Selected profile (built-in or manually authored project-local profile)
profile: PROFILE_PLACEHOLDER

workflow:
  max_attempts: 3
  plan_approval: required     # required | automatic
  review_approval: automatic  # required | automatic
  plan_export_directory: .largentic/exports  # directory for exported plan.md files

agents:
  # provider and reasoning are reserved for a future release; only system_prompt_override is enforced in V2 alpha.
  planner:
    provider: codex      # reserved (not enforced)
    reasoning: high      # reserved (not enforced)
  implementer:
    provider: codex      # reserved (not enforced)
    reasoning: medium    # reserved (not enforced)
  tester:
    provider: codex      # reserved (not enforced)
    reasoning: medium    # reserved (not enforced)
  reviewer:
    provider: codex      # reserved (not enforced)
    reasoning: high      # reserved (not enforced)

quality_gates:
  require_tests: true                # reserved (not enforced)
  require_clean_secrets_scan: true   # reserved (not enforced)
  max_changed_files: 25              # reserved; planned for V2.1
  # test_command: vendor/bin/phpunit --no-coverage --testdox  # reserved (not enforced)
  # build_command: npm run build                          # reserved (not enforced)

budget:
  max_runtime_minutes: 45       # reserved; planned for V2.1
  max_estimated_cost_usd: 10    # reserved until accurate pricing is available

# provider: codex   # override global default provider
`;

export function initCommand(cwd: string, options: { profile?: string } = {}): void {
  const harnessDir = path.join(cwd, HARNESS_DIR_NAME);
  const configPath = path.join(harnessDir, 'config.yaml');

  if (fs.existsSync(configPath)) {
    console.log(`✓ Config already exists: ${configPath}`);
    console.log('  Run "lh config validate" to check it, or edit it manually.');
    return;
  }

  const detection = detectProfile(cwd);
  const profileId = options.profile ?? detection.profile;
  let profile;
  try {
    profile = createProjectProfileRegistry(cwd).resolve(profileId);
  } catch (error: unknown) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(path.join(harnessDir, 'runs'), { recursive: true });

  const config = CONFIG_TEMPLATE.replace('PROFILE_PLACEHOLDER', profileId);
  fs.writeFileSync(configPath, config, 'utf8');

  const taskPath = path.join(harnessDir, 'task.md');
  if (!fs.existsSync(taskPath)) {
    fs.writeFileSync(taskPath, '# Task\n\nReplace this with your task description. This file is used when you run `lh run` without an inline prompt.\n', 'utf8');
  }
  const memoryPath = ensureProjectMemory(cwd);

  const materialization = applyCodexMaterialization(cwd, profile);

  console.log(`✓ Initialized ${HARNESS_NAME_WITH_VERSION}`);
  console.log(`  Config:    ${configPath}`);
  console.log(`  Task file: ${taskPath}  (edit to define your default task)`);
  console.log(`  Memory:    ${memoryPath}  (durable project knowledge for Codex)`);
  console.log(`  Profile: ${profileId}${options.profile ? ' (explicit)' : ' (detected)'}`);
  detection.hints.forEach((h) => console.log(`    • ${h}`));
  materialization.changes.forEach((change) => console.log(`  Codex ${change.action}: ${change.path}${change.reason ? ` (${change.reason})` : ''}`));
  if (materialization.conflicts.length > 0) console.log('  Existing conflicting Codex files were left untouched. Run "lh profile diff" for details.');
  console.log('\n  Next: run "lh doctor" to verify your environment.');
}
