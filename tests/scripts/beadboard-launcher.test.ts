import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const launcherPath = path.resolve('install/beadboard.mjs');

// Isolated install home so tests never read a real ~/.beadboard/server.json,
// and no inherited PORT / BB_PORT changes the default port.
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-launcher-home-'));
test.after(() => fs.rmSync(isolatedHome, { recursive: true, force: true }));

function launcherEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, BB_INSTALL_HOME: isolatedHome };
  delete env.PORT;
  delete env.BB_PORT;
  return { ...env, ...extra };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to resolve free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

test('beadboard launcher status --json reports running server', async () => {
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    // Respond to both / and /api/status
    if (req.url === '/api/status' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'running', port }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  server.listen(port, '127.0.0.1');
  
  try {
    const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'status', '--json'], {
      env: launcherEnv({ BB_PORT: port.toString() }),
    });
    
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'status');
    assert.equal(payload.running, true);
  } finally {
    server.close();
  }
});

test('beadboard launcher open --json supports noop mode', async () => {
  const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'open', '--json'], {
    env: launcherEnv({ BB_OPEN_NOOP: '1' }),
  });
  
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'open');
  assert.equal(payload.url, 'http://127.0.0.1:3000');
});

test('beadboard launcher start text includes dolt guidance', async () => {
  const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'start'], {
    env: launcherEnv({ BB_START_NOOP: '1' }),
  });
  
  assert.match(stdout, /bd dolt start/);
});

// Skip the dolt test on Windows due to platform-specific test complexity
test.skip(process.platform === 'win32' ? 'beadboard launcher start --dolt runs bd dolt start in cwd (skipped on Windows)' : 'beadboard launcher start --dolt runs bd dolt start in cwd', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadboard-start-dolt-'));
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const logPath = path.join(tmpDir, 'bd.log');
  
  // Create a simple bash script for Unix-like systems
  const bashScript = `#!/bin/bash
printf "%s|%s\n" "$PWD" "$*" > "$BB_FAKE_BD_LOG"
`;
  const scriptPath = path.join(binDir, 'bd');
  fs.writeFileSync(scriptPath, bashScript, 'utf8');
  fs.chmodSync(scriptPath, 0o755);

  const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'start', '--dolt', '--json'], {
    cwd: tmpDir,
    env: {
      ...launcherEnv(),
      BB_START_NOOP: '1',
      BB_FAKE_BD_LOG: logPath,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    },
  });

  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'start');
  assert.equal(payload.doltRequested, true);
  
  const bdInvocation = fs.readFileSync(logPath, 'utf8').trim();
  assert.equal(bdInvocation, `${tmpDir}|dolt start`);
});

// --- --port option and server record -----------------------------------

async function startNoopPayload(args: string[], extra: Record<string, string> = {}) {
  const { stdout } = await execFileAsync(process.execPath, [launcherPath, 'start', ...args, '--json'], {
    env: launcherEnv({ BB_START_NOOP: '1', ...extra }),
  });
  return JSON.parse(stdout);
}

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bb-launcher-record-'));
}

function writeRecord(home: string, record: Record<string, unknown>) {
  fs.mkdirSync(path.join(home, '.beadboard'), { recursive: true });
  fs.writeFileSync(path.join(home, '.beadboard', 'server.json'), JSON.stringify(record), 'utf8');
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.ok(child.pid);
  return child.pid;
}

function waitFor<T>(check: () => T | null, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const value = check();
      if (value !== null) return resolve(value);
      if (Date.now() > deadline) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

test('start --port <n> and --port=<n> set the port', async () => {
  const spaced = await startNoopPayload(['--port', '4123']);
  assert.equal(spaced.port, 4123);
  assert.equal(spaced.portSource, '--port');
  assert.equal(spaced.url, 'http://127.0.0.1:4123');

  const inline = await startNoopPayload(['--port=4124']);
  assert.equal(inline.port, 4124);
});

test('start port priority is --port > BB_PORT > PORT > 3000', async () => {
  assert.equal((await startNoopPayload(['--port', '4125'], { BB_PORT: '4126', PORT: '4127' })).port, 4125);
  assert.equal((await startNoopPayload([], { BB_PORT: '4126', PORT: '4127' })).port, 4126);
  const fromPort = await startNoopPayload([], { PORT: '4127' });
  assert.equal(fromPort.port, 4127);
  assert.equal(fromPort.portSource, 'PORT');
  const fallback = await startNoopPayload([]);
  assert.equal(fallback.port, 3000);
  assert.equal(fallback.portSource, 'default');
});

test('invalid --port values fail with exit code 1', async () => {
  for (const args of [['--port', 'abc'], ['--port', '70000'], ['--port', '0'], ['--port']]) {
    await assert.rejects(
      execFileAsync(process.execPath, [launcherPath, 'start', ...args], {
        env: launcherEnv({ BB_START_NOOP: '1' }),
      }),
      (err: any) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /Invalid --port value/);
        return true;
      },
      `expected failure for ${args.join(' ')}`,
    );
  }
});

test('status and open use the port saved by a live server record', async () => {
  const home = makeHome();
  const port = await getFreePort();
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    // The test process itself is a live pid.
    writeRecord(home, { port, pid: process.pid });
    const env = { ...launcherEnv({ BB_OPEN_NOOP: '1' }), BB_INSTALL_HOME: home };

    const status = JSON.parse((await execFileAsync(process.execPath, [launcherPath, 'status', '--json'], { env })).stdout);
    assert.equal(status.port, port);
    assert.equal(status.portSource, 'server-record');
    assert.equal(status.running, true);

    const open = JSON.parse((await execFileAsync(process.execPath, [launcherPath, 'open', '--json'], { env })).stdout);
    assert.equal(open.url, `http://127.0.0.1:${port}`);

    // An explicit --port still wins over the record.
    const explicit = JSON.parse(
      (await execFileAsync(process.execPath, [launcherPath, 'open', '--port', '4128', '--json'], { env })).stdout,
    );
    assert.equal(explicit.port, 4128);
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a server record from a dead process is ignored and removed', async () => {
  const home = makeHome();
  try {
    writeRecord(home, { port: 4129, pid: deadPid() });
    const env = { ...launcherEnv({ BB_OPEN_NOOP: '1' }), BB_INSTALL_HOME: home };
    const open = JSON.parse((await execFileAsync(process.execPath, [launcherPath, 'open', '--json'], { env })).stdout);
    assert.equal(open.port, 3000);
    assert.equal(open.portSource, 'default');
    assert.equal(fs.existsSync(path.join(home, '.beadboard', 'server.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('start fails fast when the port is already in use', async () => {
  const home = makeHome();
  const port = await getFreePort();
  const server = http.createServer((_req, res) => res.end('busy'));
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [launcherPath, 'start', '--port', String(port)], {
        // Point runtime root at an empty dir so nothing real could start.
        env: { ...launcherEnv(), BB_INSTALL_HOME: home, BB_RUNTIME_ROOT: home },
      }),
      (err: any) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, new RegExp(`Port ${port} is already in use`));
        return true;
      },
    );
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test(
  'start passes the port to the dev server, saves the record, and removes it on exit',
  { skip: process.platform === 'win32' ? 'uses POSIX signals' : false },
  async () => {
    const home = makeHome();
    const runtimeRoot = path.join(home, 'runtime');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    // A fake dev server that listens on PORT, like `next dev` does.
    fs.writeFileSync(
      path.join(runtimeRoot, 'package.json'),
      JSON.stringify({ name: 'fake-runtime', private: true, scripts: { dev: 'node server.js' } }),
    );
    fs.writeFileSync(
      path.join(runtimeRoot, 'server.js'),
      "require('node:http').createServer((q, s) => s.end('fake')).listen(Number(process.env.PORT), '127.0.0.1');\n",
    );
    const recordPath = path.join(home, '.beadboard', 'server.json');
    const port = await getFreePort();
    const env = { ...launcherEnv(), BB_INSTALL_HOME: home, BB_RUNTIME_ROOT: runtimeRoot };

    const launcher = spawn(process.execPath, [launcherPath, 'start', '--port', String(port), '--json'], {
      env,
      stdio: 'ignore',
    });
    const exited = new Promise<number | null>((resolve) => launcher.on('exit', (code) => resolve(code)));
    try {
      const record = await waitFor(
        () => (fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : null),
        15000,
      );
      assert.equal(record.port, port);
      assert.equal(record.pid, launcher.pid);

      // status without --port finds the running server through the record.
      const status = JSON.parse((await execFileAsync(process.execPath, [launcherPath, 'status', '--json'], { env })).stdout);
      assert.equal(status.port, port);
      assert.equal(status.portSource, 'server-record');
      assert.equal(status.running, true);

      launcher.kill('SIGTERM');
      await exited;
      assert.equal(fs.existsSync(recordPath), false);
      // The signal reached the dev server too, so the port is free again.
      await waitFor(() => {
        const probe = spawnSync(process.execPath, [
          '-e',
          `require('node:net').connect(${port}, '127.0.0.1').on('connect', () => process.exit(1)).on('error', () => process.exit(0))`,
        ]);
        return probe.status === 0 ? true : null;
      }, 5000);
    } finally {
      if (launcher.exitCode === null) launcher.kill('SIGKILL');
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
);
