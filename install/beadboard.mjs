#!/usr/bin/env node

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_PORT = 3000;
const PORT_POLL_INTERVAL_MS = 500;

function getInstallHome() {
  return process.env.BB_INSTALL_HOME || process.env.HOME || process.env.USERPROFILE || '';
}

function getRuntimeMetadata() {
  const installHome = getInstallHome();
  const version = (process.env.BB_RUNTIME_VERSION || '0.1.0').trim();
  const runtimeRoot =
    process.env.BB_RUNTIME_ROOT || path.join(installHome, '.beadboard', 'runtime', version);
  const shimTarget = process.env.BB_SHIM_TARGET || __filename;
  const installMode =
    process.env.BB_INSTALL_MODE ||
    (__dirname.includes(`${path.sep}.beadboard${path.sep}runtime${path.sep}`)
      ? 'runtime-managed'
      : 'repo-shim');
  return { runtimeRoot, shimTarget, installMode };
}

function parseArgs(argv) {
  const args = [...argv];
  const jsonIndex = args.indexOf('--json');
  const json = jsonIndex !== -1;
  if (json) args.splice(jsonIndex, 1);
  const doltIndex = args.indexOf('--dolt');
  const dolt = doltIndex !== -1;
  if (dolt) args.splice(doltIndex, 1);

  // Accept both `--port 4000` and `--port=4000`.
  let port = null;
  let portError = null;
  const portIndex = args.findIndex((arg) => arg === '--port' || arg.startsWith('--port='));
  if (portIndex !== -1) {
    const isInline = args[portIndex].startsWith('--port=');
    const raw = isInline ? args[portIndex].slice('--port='.length) : args[portIndex + 1];
    args.splice(portIndex, isInline ? 1 : 2);
    port = parsePortValue(raw);
    if (port === null) {
      portError = `Invalid --port value: ${raw ?? '(missing)'}. Use an integer from 1 to 65535.`;
    }
  }

  return {
    command: args[0] || 'help',
    json,
    dolt,
    port,
    portError,
  };
}

function parsePortValue(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value >= 1 && value <= 65535 ? value : null;
}

function output(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.ok === false) {
    process.stderr.write(`${payload.error}\n`);
    return;
  }
  if (payload.command === 'status') {
    const statusLines = [
      'BeadBoard status',
      `Running: ${payload.running ? 'yes' : 'no'}`,
      `URL: ${payload.url}`,
      `Port: ${payload.port}`,
      `Install Mode: ${payload.installMode}`,
      `Runtime Root: ${payload.runtimeRoot}`,
      `Shim Target: ${payload.shimTarget}`,
      `bd Available: ${payload.bd?.available ? 'yes' : 'no'}`,
      `bd Path: ${payload.bd?.path || '(not found)'}`,
      `Project CWD: ${payload.bd?.project?.cwd || process.cwd()}`,
      `.beads Dir: ${payload.bd?.project?.hasBeadsDir ? 'yes' : 'no'}`,
      `SQLite Legacy DB: ${payload.bd?.backend?.sqliteLegacyDb ? 'yes' : 'no'}`,
      `SQLite Migrated DB: ${payload.bd?.backend?.sqliteMigratedDb ? 'yes' : 'no'}`,
      `Dolt Repo: ${payload.bd?.backend?.doltRepo ? 'yes' : 'no'}`,
    ];
    process.stdout.write(`${statusLines.join('\n')}\n`);
    return;
  }
  if (payload.command === 'open') {
    process.stdout.write(`Open ${payload.url}\n`);
    return;
  }
  if (payload.command === 'start') {
    const startLines = [
      'Starting BeadBoard dev server...',
      `URL: ${payload.url}`,
      'Tip: In your project folder, run `bd dolt start` first.',
      'Shortcut: `beadboard start --dolt` runs Dolt + BeadBoard startup together.',
    ];
    if (payload.doltRequested) {
      startLines.push(`Dolt startup: ${payload.doltStarted ? 'started' : 'not started'}`);
      if (payload.doltMessage) {
        startLines.push(`Dolt detail: ${payload.doltMessage}`);
      }
    }
    process.stdout.write(`${startLines.join('\n')}\n`);
    return;
  }
  process.stdout.write('Usage: beadboard <start|open|status> [--json] [--dolt] [--port <n>]\n');
}

// The server record remembers which port a running `beadboard start` uses,
// so later `status` / `open` calls find it without repeating --port.
function getServerRecordPath() {
  const installHome = getInstallHome();
  return installHome ? path.join(installHome, '.beadboard', 'server.json') : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return err.code === 'EPERM';
  }
}

function readServerRecord() {
  const recordPath = getServerRecordPath();
  if (!recordPath) return null;
  let record;
  try {
    record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch {
    return null;
  }
  const port = parsePortValue(String(record?.port ?? ''));
  const pid = record?.pid;
  if (port === null || !Number.isInteger(pid) || pid <= 0) return null;
  if (!isProcessAlive(pid)) {
    // The launcher that wrote this record is gone (crash or kill -9).
    fs.rmSync(recordPath, { force: true });
    return null;
  }
  return { ...record, port, pid };
}

function writeServerRecord(record) {
  const recordPath = getServerRecordPath();
  if (!recordPath) return;
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function removeServerRecord(ownerPid) {
  const recordPath = getServerRecordPath();
  if (!recordPath) return;
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    // Only remove our own record; a newer `beadboard start` may have replaced it.
    if (record?.pid === ownerPid) fs.rmSync(recordPath, { force: true });
  } catch {
    // No record, or unreadable record: nothing to clean up.
  }
}

// Port priority:
//   start:       --port > BB_PORT > PORT > 3000
//   status/open: --port > BB_PORT > server record > PORT > 3000
function resolvePort(command, cliPort) {
  if (cliPort !== null) return { port: cliPort, source: '--port' };
  const bbPort = parsePortValue(process.env.BB_PORT);
  if (bbPort !== null) return { port: bbPort, source: 'BB_PORT' };
  if (command !== 'start') {
    const record = readServerRecord();
    if (record) return { port: record.port, source: 'server-record' };
  }
  const envPort = parsePortValue(process.env.PORT);
  if (envPort !== null) return { port: envPort, source: 'PORT' };
  return { port: DEFAULT_PORT, source: 'default' };
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function waitForPort(port, hasExited) {
  while (!hasExited()) {
    if (await isPortInUse(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, PORT_POLL_INTERVAL_MS));
  }
  return false;
}

function splitPathVariable(value) {
  if (!value) return [];
  return value.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function resolveBdPath() {
  const pathEntries = splitPathVariable(process.env.PATH || '');
  const candidates =
    process.platform === 'win32'
      ? ['bd.cmd', 'bd.exe', 'bd.ps1', 'bd.bat', 'bd']
      : ['bd'];
  for (const dir of pathEntries) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function getBdDiagnostics() {
  const beadsDir = path.resolve(process.cwd(), '.beads');
  const dbPath = path.join(beadsDir, 'beads.db');
  const migratedDbPath = path.join(beadsDir, 'beads.db.migrated');
  const doltRepoPath = path.join(beadsDir, 'dolt');
  const bdPath = resolveBdPath();
  return {
    available: Boolean(bdPath),
    path: bdPath,
    project: {
      cwd: process.cwd(),
      hasBeadsDir: fs.existsSync(beadsDir),
      hasBeadsDb: fs.existsSync(dbPath),
    },
    backend: {
      sqliteLegacyDb: fs.existsSync(dbPath),
      sqliteMigratedDb: fs.existsSync(migratedDbPath),
      doltRepo: fs.existsSync(doltRepoPath),
    },
  };
}

function statusRequest(port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        timeout: 1200,
      },
      (res) => {
        res.resume();
        resolve({ running: true, statusCode: res.statusCode || 200 });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ running: false, statusCode: null });
    });
    req.on('error', () => resolve({ running: false, statusCode: null }));
  });
}

function openUrl(url) {
  if (process.env.BB_OPEN_NOOP === '1') return;

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    child.on('error', (err) => {
      process.stderr.write(`Warning: Failed to open URL: ${err.message}\n`);
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
    child.on('error', (err) => {
      process.stderr.write(`Warning: Failed to open URL: ${err.message}\n`);
    });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
  child.on('error', (err) => {
    process.stderr.write(`Warning: Failed to open URL: ${err.message}\n`);
  });
  child.unref();
}

function hasDevScript(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts && pkg.scripts.dev);
  } catch {
    return false;
  }
}

function startDoltInProject(cwd) {
  const bdPath = resolveBdPath();
  if (!bdPath) {
    return {
      attempted: false,
      started: false,
      message: 'bd not found on PATH; run `bd dolt start` manually in your project folder.',
    };
  }

  const dolt = spawnSync(bdPath, ['dolt', 'start'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const started = (dolt.status ?? 1) === 0;
  return {
    attempted: true,
    started,
    message: started
      ? 'bd dolt start completed.'
      : 'bd dolt start failed; continuing with BeadBoard startup.',
  };
}

async function main() {
  const { command, json, dolt, port: cliPort, portError } = parseArgs(process.argv.slice(2));
  if (portError) {
    output({ ok: false, command, error: portError }, json);
    process.exit(1);
  }
  const { port, source: portSource } = resolvePort(command, cliPort);
  const url = `http://127.0.0.1:${port}`;
  const runtime = getRuntimeMetadata();
  const startNoop = process.env.BB_START_NOOP === '1';

  if (command === 'start') {
    // Check before starting Dolt so a busy port fails fast. An explicit PORT
    // also stops `next dev` from silently moving to the next free port.
    if (!startNoop && (await isPortInUse(port))) {
      output(
        {
          ok: false,
          command: 'start',
          port,
          url,
          error: `Port ${port} is already in use. Pick another port with --port <n>.`,
        },
        json,
      );
      process.exit(1);
    }
    const doltState = dolt
      ? startDoltInProject(process.cwd())
      : { attempted: false, started: false, message: null };
    const startRoot = hasDevScript(runtime.runtimeRoot) ? runtime.runtimeRoot : repoRoot;
    if (startNoop) {
      output(
        {
          ok: true,
          command: 'start',
          startRoot,
          port,
          portSource,
          url,
          doltRequested: dolt,
          doltAttempted: doltState.attempted,
          doltStarted: doltState.started,
          doltMessage: doltState.message,
        },
        json,
      );
      return;
    }
    const child = spawn('npm', ['run', 'dev'], {
      cwd: startRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, PORT: String(port) },
    });
    child.on('error', (err) => {
      process.stderr.write(`Error: Failed to start dev server: ${err.message}\n`);
      process.exit(1);
    });
    let childExited = false;
    process.on('exit', () => removeServerRecord(process.pid));
    // Keep the launcher alive until the dev server exits, so the record is
    // removed on Ctrl+C or kill. On Windows, Ctrl+C already reaches the child.
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        if (!childExited && process.platform !== 'win32') child.kill(signal);
      });
    }
    child.on('exit', (code) => {
      childExited = true;
      process.exit(code ?? 0);
    });
    void waitForPort(port, () => childExited).then((listening) => {
      if (!listening || childExited) return;
      writeServerRecord({
        port,
        url,
        pid: process.pid,
        startRoot,
        startedAt: new Date().toISOString(),
      });
    });
    output(
      {
        ok: true,
        command: 'start',
        port,
        portSource,
        url,
        doltRequested: dolt,
        doltAttempted: doltState.attempted,
        doltStarted: doltState.started,
        doltMessage: doltState.message,
      },
      json,
    );
    return;
  }

  if (command === 'open') {
    openUrl(url);
    output({ ok: true, command: 'open', url, port, portSource }, json);
    return;
  }

  if (command === 'status') {
    const probe = await statusRequest(port);
    const payload = {
      ok: true,
      command: 'status',
      running: probe.running,
      statusCode: probe.statusCode,
      url,
      port,
      portSource,
      runtimeRoot: runtime.runtimeRoot,
      installMode: runtime.installMode,
      shimTarget: runtime.shimTarget,
      bd: getBdDiagnostics(),
    };
    output(payload, json);
    process.exit(json ? (probe.running ? 0 : 1) : 0);
    return;
  }

  output({ ok: true, command: 'help' }, json);
}

void main();
