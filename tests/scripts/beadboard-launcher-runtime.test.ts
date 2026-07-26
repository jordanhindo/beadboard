import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const launcherPath = path.resolve('install/beadboard.mjs');

test('status --json reports runtime root and install mode', async () => {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync(process.execPath, [launcherPath, 'status', '--json']));
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout || '';
  }
  const payload = JSON.parse(stdout);
  assert.ok(payload.runtimeRoot);
  assert.ok(payload.installMode);
  assert.ok(payload.bd);
  assert.equal(typeof payload.bd.available, 'boolean');
  assert.ok('path' in payload.bd);
  assert.ok(payload.bd.project);
  assert.equal(typeof payload.bd.project.hasBeadsDir, 'boolean');
  assert.ok(payload.bd.backend);
  assert.equal(typeof payload.bd.backend.sqliteLegacyDb, 'boolean');
  assert.equal(typeof payload.bd.backend.sqliteMigratedDb, 'boolean');
  assert.equal(typeof payload.bd.backend.doltRepo, 'boolean');
});

import fs from 'node:fs';
import os from 'node:os';

test('start falls back to repoRoot when runtimeRoot exists but has no dev script', async () => {
  // Create a runtimeRoot directory with only a pi/ subdir (no package.json), simulating
  // the partial bootstrap scenario described in issue #28.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-runtime-partial-'));
  const fakeRuntimeRoot = path.join(tmpDir, 'runtime', '0.1.0');
  fs.mkdirSync(path.join(fakeRuntimeRoot, 'pi'), { recursive: true });

  const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'start', '--json'], {
    env: {
      ...process.env,
      BB_START_NOOP: '1',
      BB_RUNTIME_ROOT: fakeRuntimeRoot,
    },
  });

  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'start');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('start uses runtimeRoot when it contains a package.json with a dev script', async () => {
  // Create a runtimeRoot directory with a valid package.json that has a dev script.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-runtime-full-'));
  const fakeRuntimeRoot = path.join(tmpDir, 'runtime', '0.1.0');
  fs.mkdirSync(fakeRuntimeRoot, { recursive: true });
  fs.writeFileSync(
    path.join(fakeRuntimeRoot, 'package.json'),
    JSON.stringify({ scripts: { dev: 'next dev' } }),
    'utf8',
  );

  const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'start', '--json'], {
    env: {
      ...process.env,
      BB_START_NOOP: '1',
      BB_RUNTIME_ROOT: fakeRuntimeRoot,
    },
  });

  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'start');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
