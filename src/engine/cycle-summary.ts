import * as fs from 'fs';
import * as path from 'path';
import type { RunState } from '../types.js';
import type { RunPaths } from './run-manager.js';

const MAX_SECTION_LENGTH = 700;

interface CycleSummaryOptions {
  paths: RunPaths;
  task: string;
  state: RunState;
}

export interface CycleSummaryWriteResult {
  summary?: string;
  error?: string;
}

/** Write a concise, deterministic end-of-cycle handoff without another provider call. */
export function writeCycleSummary({ paths, task, state }: CycleSummaryOptions): string {
  const implementation = readArtifact(paths.runDir, 'implementation.md');
  const tests = readArtifact(paths.runDir, 'test-results.md');
  const review = readArtifact(paths.runDir, 'review.md');

  const summary = [
    '# Cycle Summary',
    '',
    `**Run ID:** ${state.run_id}`,
    `**Status:** ${state.status.toUpperCase()}`,
    `**Task:** ${task}`,
    '',
    '## Changes',
    extractSection(implementation, ['Implemented', 'Changes Made', 'Summary'], 'No implementation summary was produced.'),
    '',
    '## Verification',
    extractSection(tests, ['Results', 'Behavior Verified', 'Verification'], 'No test summary was produced.'),
    '',
    '## Review',
    extractSection(review, ['Verdict', 'Summary', 'Review'], 'No review summary was produced.'),
    state.failure_reason ? `\n## Completion Note\n${state.failure_reason}` : '',
    '',
  ].join('\n');

  fs.writeFileSync(paths.summaryFile, summary, 'utf8');
  return summary;
}

/** Keep reporting failures from changing the outcome of an already-completed workflow. */
export function tryWriteCycleSummary(options: CycleSummaryOptions): CycleSummaryWriteResult {
  try {
    return { summary: writeCycleSummary(options) };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function readArtifact(runDir: string, filename: string): string {
  const artifactPath = path.join(runDir, filename);
  return fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : '';
}

function extractSection(markdown: string, headings: string[], fallback: string): string {
  if (!markdown.trim()) return fallback;

  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return Boolean(match && headings.some((heading) => match[2].toLowerCase() === heading.toLowerCase()));
  });

  const source = headingIndex >= 0
    ? lines.slice(headingIndex + 1, findNextHeading(lines, headingIndex + 1)).join('\n')
    : markdown;
  const concise = source.trim().replace(/\n{3,}/g, '\n\n');
  if (!concise) return fallback;
  return concise.length <= MAX_SECTION_LENGTH ? concise : `${concise.slice(0, MAX_SECTION_LENGTH).trimEnd()}…`;
}

function findNextHeading(lines: string[], start: number): number {
  const index = lines.slice(start).findIndex((line) => /^#{1,6}\s+/.test(line));
  return index < 0 ? lines.length : start + index;
}
