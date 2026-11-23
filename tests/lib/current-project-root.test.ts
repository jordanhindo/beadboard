import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getCurrentProjectRoot } from '../../src/lib/current-project-root';
import { readIssuesFromDisk, resolveIssuesJsonlPathCandidates } from '../../src/lib/read-issues';

function withProjectRootEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.BB_PROJECT_ROOT;
  if (value === undefined) delete process.env.BB_PROJECT_ROOT;
  else process.env.BB_PROJECT_ROOT = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.BB_PROJECT_ROOT;
    else process.env.BB_PROJECT_ROOT = previous;
  }
}

test('getCurrentProjectRoot falls back to the working directory', () => {
  withProjectRootEnv(undefined, () => assert.equal(getCurrentProjectRoot(), process.cwd()));
  withProjectRootEnv('   ', () => assert.equal(getCurrentProjectRoot(), process.cwd()));
});

test('getCurrentProjectRoot uses BB_PROJECT_ROOT when set', () => {
  withProjectRootEnv('/some/project', () => assert.equal(getCurrentProjectRoot(), '/some/project'));
});

test('default issue paths follow BB_PROJECT_ROOT', () => {
  withProjectRootEnv('/some/project', () => {
    const candidates = resolveIssuesJsonlPathCandidates();
    assert.ok(candidates.length > 0);
    for (const candidate of candidates) {
      assert.ok(candidate.startsWith(path.join('/some/project', '.beads')), candidate);
    }
  });
});

test('readIssuesFromDisk reads the BB_PROJECT_ROOT project by default', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-current-project-'));
  try {
    fs.mkdirSync(path.join(projectRoot, '.beads'));
    fs.writeFileSync(
      path.join(projectRoot, '.beads', 'issues.jsonl'),
      `${JSON.stringify({ id: 'other-1', title: 'From the other project', status: 'open', priority: 2, issue_type: 'task' })}\n`,
    );
    const previous = process.env.BB_PROJECT_ROOT;
    process.env.BB_PROJECT_ROOT = projectRoot;
    try {
      const issues = await readIssuesFromDisk();
      assert.deepEqual(issues.map((issue) => issue.id), ['other-1']);
    } finally {
      if (previous === undefined) delete process.env.BB_PROJECT_ROOT;
      else process.env.BB_PROJECT_ROOT = previous;
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
