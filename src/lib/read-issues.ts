import fs from 'node:fs/promises';
import path from 'node:path';

import { parseIssuesJsonl } from './parser';
import { buildProjectContext } from './project-context';
import { readIssuesViaDolt } from './read-issues-dolt';
import type { BeadIssueWithProject, ProjectSource } from './types';
import { getCurrentProjectRoot } from './current-project-root';

export interface ReadIssuesOptions {
  projectRoot?: string;
  includeTombstones?: boolean;
  projectSource?: ProjectSource;
  projectAddedAt?: string | null;
  preferBd?: boolean;
  skipAgentFilter?: boolean;
}

export function resolveIssuesJsonlPathCandidates(projectRoot: string = getCurrentProjectRoot()): string[] {
  const baseDir = path.resolve(projectRoot, '.beads');
  return [
    path.join(baseDir, 'issues.jsonl'),
    path.join(baseDir, 'issues.jsonl.new'),
  ];
}

export function resolveIssuesJsonlPath(projectRoot: string = getCurrentProjectRoot()): string {
  return resolveIssuesJsonlPathCandidates(projectRoot)[0];
}

/**
 * Write issues to disk using BD audit record when available.
 * This ensures all writes go through the BD audit system for watcher/SSE parity.
 */
export async function writeIssuesToDisk(
  issues: BeadIssueWithProject[],
  options: ReadIssuesOptions = {}
): Promise<void> {
  const projectRoot = options.projectRoot ?? getCurrentProjectRoot();
  const issuesJson = JSON.stringify(issues, null, 2);

  try {
    const { execFileSync } = await import('child_process');
    execFileSync('bd', ['audit', 'record', '--stdin'], {
      cwd: projectRoot,
      input: issuesJson,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    const issuesPath = resolveIssuesJsonlPath(projectRoot);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(issuesPath, issuesJson, 'utf8');
  }
}

export async function readIssuesFromDisk(options: ReadIssuesOptions = {}): Promise<BeadIssueWithProject[]> {
  const projectRoot = options.projectRoot ?? getCurrentProjectRoot();
  const project = buildProjectContext(projectRoot, {
    source: options.projectSource ?? 'local',
    addedAt: options.projectAddedAt ?? null,
  });

  // Try Dolt first
  const viaDolt = await readIssuesViaDolt(projectRoot, options);
  if (viaDolt !== null) {
    return viaDolt.map((issue) => ({ ...issue, project }));
  }

  // Fall back to JSONL on disk when Dolt is unavailable
  for (const candidate of resolveIssuesJsonlPathCandidates(projectRoot)) {
    try {
      const text = await fs.readFile(candidate, 'utf8');
      const issues = parseIssuesJsonl(text, {
        includeTombstones: options.includeTombstones,
        skipAgentFilter: options.skipAgentFilter,
      });
      return issues.map((issue) => ({ ...issue, project }));
    } catch {
      continue;
    }
  }

  return [];
}
