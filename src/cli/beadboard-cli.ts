import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getRuntimePaths, resolveInstallHome } from '../lib/runtime-manager';
import {
  registerAgent,
  listAgents,
  showAgent,
  extendActivityLease,
  type AgentCommandResponse,
} from '../lib/agent-registry';
import {
  sendAgentMessage,
  inboxAgentMessages,
  readAgentMessage,
  ackAgentMessage,
  type MailCommandResponse,
  type MessageCategory,
} from '../lib/agent-mail';
import {
  reserveAgentScope,
  releaseAgentReservation,
  statusAgentReservations,
  type ReservationCommandResponse,
} from '../lib/agent-reservations';
import { bbDaemon } from '../lib/bb-daemon';
import { bootstrapManagedPi } from '../lib/bb-pi-bootstrap';
import { renderDaemonTuiText } from '../tui/bb-daemon-tui';
import { runBbAgentTui } from '../tui/bb-agent-tui';

export type CliResult = {
  ok: boolean;
  command: string;
  [key: string]: unknown;
};

type AnyCommandResponse =
  | AgentCommandResponse<any>
  | MailCommandResponse<any>
  | ReservationCommandResponse<any>;

function stringArg(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function booleanArg(value: string | boolean | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function renderAgentHelpText(): string {
  return [
    'Usage: bb agent <command> [options]',
    '',
    'Commands:',
    '  register       Register or update an agent identity',
    '  list           List registered agents',
    '  show           Show one registered agent',
    '  activity-lease Extend the activity lease (silent refresh)',
    '  send           Send a message to an agent',
    '  inbox          List inbox messages for an agent',
    '  read           Mark one message as read',
    '  ack            Acknowledge one message',
    '  reserve        Reserve a work scope',
    '  release        Release a reservation scope',
    '  status         Show reservation/message status',
  ].join('\n');
}

function renderAgentResponseText(response: AnyCommandResponse): string {
  if (!response.ok) {
    return `Error: [${response.error?.code}] ${response.error?.message}`;
  }

  if (response.command === 'agent register') {
    const d = response.data;
    return `✓ Agent registered: ${d.agent_id} (role: ${d.role}, status: ${d.status})`;
  }
  if (response.command === 'agent list') {
    const list = response.data as any[];
    if (list.length === 0) {
      return 'Found 0 agents.';
    }
    return `Found ${list.length} agents:\n${list.map((a) => `- ${a.agent_id} (${a.role}) [${a.status}]`).join('\n')}`;
  }
  if (response.command === 'agent show') {
    const d = response.data;
    return `Agent: ${d.agent_id}\nRole: ${d.role}\nStatus: ${d.status}\nLast Seen: ${d.last_seen_at}`;
  }
  if (response.command === 'agent activity-lease') {
    const d = response.data;
    if (d) {
      return `✓ Activity lease extended: ${d.agent_id} (version: ${d.version})`;
    }
    return '✓ Activity lease extended.';
  }
  if (response.command === 'agent send') {
    const d = response.data;
    return `✓ Message sent: ${d.message_id} (state: ${d.state})`;
  }
  if (response.command === 'agent inbox') {
    const list = response.data as any[];
    if (list.length === 0) {
      return 'Inbox (0):';
    }
    return `Inbox (${list.length}):\n${list.map((m) => `- [${m.message_id}] ${m.category}: ${m.subject} (from: ${m.from_agent})`).join('\n')}`;
  }
  if (response.command === 'agent read') {
    const d = response.data;
    return `✓ Message read: ${d.message_id} (state: ${d.state})`;
  }
  if (response.command === 'agent ack') {
    const d = response.data;
    return `✓ Message acked: ${d.message_id} (state: ${d.state})`;
  }
  if (response.command === 'agent reserve') {
    const d = response.data;
    return `✓ Scope reserved: ${d.reservation_id}\nScope: ${d.scope}\nExpires: ${d.expires_at}`;
  }
  if (response.command === 'agent release') {
    const d = response.data;
    return `✓ Reservation released. State: ${d.state}`;
  }
  if (response.command === 'agent status') {
    const d = response.data;
    const reservations = d.reservations.map((r: any) => `- ${r.scope} (agent: ${r.agent_id}, expires: ${r.expires_at})`).join('\n');
    return `Active Reservations: ${d.reservations.length}${reservations ? `\n${reservations}` : ''}\nUnacked Required Messages: ${d.unacked_required_messages.length}`;
  }

  return `Success: ${JSON.stringify(response.data)}`;
}

async function runAgentCli(argv: string[], asJson: boolean): Promise<CliResult> {
  const subcommand = argv[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    return { ok: true, command: 'agent help', text: renderAgentHelpText() };
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      name: { type: 'string' },
      role: { type: 'string' },
      display: { type: 'string' },
      'force-update': { type: 'boolean' },
      agent: { type: 'string' },
      status: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      bead: { type: 'string' },
      category: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
      thread: { type: 'string' },
      state: { type: 'string' },
      message: { type: 'string' },
      limit: { type: 'string' },
      scope: { type: 'string' },
      ttl: { type: 'string' },
      'takeover-stale': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    strict: false,
  });

  try {
    let result: AnyCommandResponse;
    const deps = {};
    const targetAgent = stringArg(values.agent) || stringArg(values.from) || stringArg(values.name);
    if (targetAgent && subcommand !== 'register' && subcommand !== 'activity-lease') {
      await extendActivityLease({ agent: targetAgent }, deps).catch(() => {});
    }

    switch (subcommand) {
      case 'register':
        if (!values.name || !values.role) throw new Error('--name and --role required');
        result = await registerAgent({
          name: stringArg(values.name)!,
          role: stringArg(values.role)!,
          display: stringArg(values.display),
          forceUpdate: booleanArg(values['force-update']),
        }, deps);
        break;
      case 'list':
        result = await listAgents({
          role: stringArg(values.role),
          status: stringArg(values.status),
        });
        break;
      case 'show':
        if (!values.agent) throw new Error('--agent required');
        result = await showAgent({ agent: stringArg(values.agent)! });
        break;
      case 'activity-lease':
        if (!values.agent) throw new Error('--agent required');
        result = await extendActivityLease({ agent: stringArg(values.agent)! }, deps);
        break;
      case 'send':
        if (!values.from || !values.to || !values.bead || !values.category || !values.subject || !values.body) {
          throw new Error('--from, --to, --bead, --category, --subject, --body required');
        }
        result = await sendAgentMessage({
          from: stringArg(values.from)!,
          to: stringArg(values.to)!,
          bead: stringArg(values.bead)!,
          category: stringArg(values.category)! as MessageCategory,
          subject: stringArg(values.subject)!,
          body: stringArg(values.body)!,
          thread: stringArg(values.thread),
        }, deps);
        break;
      case 'inbox':
        if (!values.agent) throw new Error('--agent required');
        result = await inboxAgentMessages({
          agent: stringArg(values.agent)!,
          state: stringArg(values.state) as any,
          bead: stringArg(values.bead),
          limit: stringArg(values.limit) ? parseInt(stringArg(values.limit)!, 10) : undefined,
        });
        break;
      case 'read':
        if (!values.agent || !values.message) throw new Error('--agent and --message required');
        result = await readAgentMessage({ agent: stringArg(values.agent)!, message: stringArg(values.message)! }, deps);
        break;
      case 'ack':
        if (!values.agent || !values.message) throw new Error('--agent and --message required');
        result = await ackAgentMessage({ agent: stringArg(values.agent)!, message: stringArg(values.message)! }, deps);
        break;
      case 'reserve':
        if (!values.agent || !values.scope || !values.bead) throw new Error('--agent, --scope, --bead required');
        result = await reserveAgentScope({
          agent: stringArg(values.agent)!,
          scope: stringArg(values.scope)!,
          bead: stringArg(values.bead)!,
          ttl: stringArg(values.ttl) ? parseInt(stringArg(values.ttl)!, 10) : undefined,
          takeoverStale: booleanArg(values['takeover-stale']),
        }, deps);
        break;
      case 'release':
        if (!values.agent || !values.scope) throw new Error('--agent and --scope required');
        result = await releaseAgentReservation({ agent: stringArg(values.agent)!, scope: stringArg(values.scope)! }, deps);
        break;
      case 'status':
        result = await statusAgentReservations({
          bead: stringArg(values.bead),
          agent: stringArg(values.agent),
        }, deps);
        break;
      default:
        return { ok: false, command: `agent ${subcommand}`, error: `Unknown agent command: ${subcommand}` };
    }

    if (asJson) {
      return result as unknown as CliResult;
    }
    return {
      ok: result.ok,
      command: result.command,
      text: renderAgentResponseText(result),
      data: result.data,
      error: result.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (asJson) {
      return {
        ok: false,
        command: `agent ${subcommand}`,
        data: null,
        error: { code: 'CLI_ERROR', message },
      };
    }
    return {
      ok: false,
      command: `agent ${subcommand}`,
      text: `Error: ${message}`,
      error: { code: 'CLI_ERROR', message },
    };
  }
}

function renderDaemonHelpText(): string {
  return [
    'Usage: bb daemon <command> [options]',
    '',
    'Commands:',
    '  start        Start the BeadBoard daemon lifecycle',
    '  status       Show daemon lifecycle and project status',
    '  stop         Stop the BeadBoard daemon lifecycle',
    '  bootstrap    Install the BeadBoard agent runtime',
    '  tui          Open the interactive BeadBoard agent TUI',
    '',
    'TUI options:',
    '  --project-root <path>   Run the bb agent in an explicit external project workspace',
    '  --project-key <key>     Run the bb agent in a registered BeadBoard project workspace',
  ].join('\n');
}

async function runDaemonCli(argv: string[], asJson: boolean): Promise<CliResult> {
  const subcommand = argv[0];
  const projectRootFlagIndex = argv.indexOf('--project-root');
  const projectKeyFlagIndex = argv.indexOf('--project-key');
  const projectRoot = projectRootFlagIndex >= 0 ? argv[projectRootFlagIndex + 1] : undefined;
  const projectKey = projectKeyFlagIndex >= 0 ? argv[projectKeyFlagIndex + 1] : undefined;
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    return { ok: true, command: 'daemon help', text: renderDaemonHelpText() };
  }

  if (subcommand === 'start') {
    const lifecycle = await bbDaemon.start();
    const status = bbDaemon.getStatus();
    const runtimeMode = status.piRuntime ? `${status.piRuntime.mode} / ${status.piRuntime.installState}` : 'unknown';
    return {
      ok: true,
      command: 'daemon start',
      text: `✓ BeadBoard daemon started (${lifecycle.status}) using ${runtimeMode}`,
      lifecycle,
      status,
    };
  }

  if (subcommand === 'status') {
    const status = bbDaemon.getStatus();
    const runtimeMode = status.piRuntime ? `${status.piRuntime.mode} / ${status.piRuntime.installState}` : 'unknown';
    return {
      ok: true,
      command: 'daemon status',
      text: `Daemon: ${status.lifecycle.status} (${status.daemon.projectCount} projects) · Agent runtime: ${runtimeMode}`,
      status,
    };
  }

  if (subcommand === 'stop') {
    const lifecycle = await bbDaemon.stop();
    return {
      ok: true,
      command: 'daemon stop',
      text: `✓ BeadBoard daemon stopped (${lifecycle.status})`,
      lifecycle,
      status: bbDaemon.getStatus(),
    };
  }

  if (subcommand === 'bootstrap' || subcommand === 'bootstrap-pi') {
    const result = await bootstrapManagedPi();
    return {
      ok: true,
      command: 'daemon bootstrap',
      text: result.alreadyInstalled
        ? `✓ BeadBoard agent runtime ready at ${result.managedRoot}`
        : `✓ BeadBoard agent runtime installed at ${result.managedRoot}`,
      bootstrap: result,
    };
  }

  if (subcommand === 'tui') {
    await bbDaemon.ensureRunning();
    return {
      ok: true,
      command: 'daemon tui',
      text: 'Starting interactive BeadBoard agent TUI...',
      preview: renderDaemonTuiText(),
      status: bbDaemon.getStatus(),
      planned: false,
      interactive: true,
      projectRoot: projectRoot ?? null,
      projectKey: projectKey ?? null,
    };
  }

  const error = { code: 'CLI_ERROR', message: `Unknown daemon command: ${subcommand}` };
  if (asJson) {
    return { ok: false, command: `daemon ${subcommand}`, error };
  }
  return { ok: false, command: `daemon ${subcommand}`, text: `Error: ${error.message}`, error };
}

function parseVersion(env: NodeJS.ProcessEnv): string {
  const raw = (env.BB_RUNTIME_VERSION || env.npm_package_version || '0.1.0').trim();
  return raw.startsWith('v') ? raw.slice(1) : raw;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliResult> {
  const args = [...argv];
  const asJson = args.includes('--json');
  const yes = args.includes('--yes');
  const commandIndex = args.findIndex((arg) => !arg.startsWith('-'));
  const command = commandIndex >= 0 ? args[commandIndex] : 'help';

  const installHome = resolveInstallHome({ ...env, HOME: env.HOME || os.homedir() });
  const version = parseVersion(env);
  const runtime = getRuntimePaths(installHome, version);

  if (command === 'agent') {
    const subArgs = commandIndex >= 0 ? args.slice(commandIndex + 1) : [];
    return runAgentCli(subArgs, asJson);
  }

  if (command === 'daemon') {
    const subArgs = commandIndex >= 0 ? args.slice(commandIndex + 1) : [];
    return runDaemonCli(subArgs, asJson);
  }

  if (command === 'doctor') {
    return {
      ok: true,
      command,
      json: asJson,
      installMode: env.BB_INSTALL_MODE || 'npm-global-or-wrapper',
      installHome,
      runtimeRoot: runtime.runtimeRoot,
      runtimeCurrentMetadata: runtime.runtimeCurrentMetadata,
      shimDir: runtime.shimDir,
    };
  }

  if (command === 'self-update') {
    return {
      ok: true,
      command,
      updated: false,
      message: 'Self-update is not configured for this distribution yet. Reinstall with npm i -g beadboard when published.',
    };
  }

  if (command === 'uninstall') {
    if (!yes) {
      return {
        ok: false,
        command,
        error: 'Refusing uninstall without --yes',
      };
    }

    await Promise.all([
      fs.rm(runtime.runtimeBase, { recursive: true, force: true }),
      fs.rm(runtime.shimDir, { recursive: true, force: true }),
    ]);

    return {
      ok: true,
      command,
      removed: [runtime.runtimeBase, runtime.shimDir],
    };
  }

  return {
    ok: true,
    command: 'help',
    usage: 'beadboard <agent|daemon|doctor|self-update|uninstall> [--json] [--yes]',
    text: renderHelpText(),
  };
}

function renderHelpText(): string {
  return [
    'Usage:',
    '  beadboard <command> [options]',
    '',
    'Runtime Commands:',
    '  beadboard start [--dolt] [--port <n>]',
    '                               Start BeadBoard runtime (optionally start Dolt first)',
    '  beadboard open [--port <n>]  Open BeadBoard in browser',
    '  beadboard status [--json] [--port <n>]',
    '                               Show runtime + bd diagnostics',
    '                               Port: --port > BB_PORT > running server > PORT > 3000',
    '  beadboard daemon <command>   Control the BeadBoard daemon lifecycle',
    '  beadboard agent <command>    Run coordination commands (register/send/inbox/ack/reserve/...)',
    '',
    'Management Commands:',
    '  beadboard doctor [--json]    Show install/runtime diagnostics',
    '  beadboard self-update        Print update guidance',
    '  beadboard uninstall --yes    Remove runtime + shims',
    '',
    'Options:',
    '  --json                       Return structured JSON output',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const isDaemonTui = argv[0] === 'daemon' && argv[1] === 'tui' && !asJson;

  if (isDaemonTui) {
    const projectRootFlagIndex = argv.indexOf('--project-root');
    const projectKeyFlagIndex = argv.indexOf('--project-key');
    const projectRoot = projectRootFlagIndex >= 0 ? argv[projectRootFlagIndex + 1] : undefined;
    const projectKey = projectKeyFlagIndex >= 0 ? argv[projectKeyFlagIndex + 1] : undefined;

    await bbDaemon.ensureRunning();
    await runBbAgentTui({
      cwd: process.cwd(),
      projectRoot,
      projectKey,
      testMode: process.env.BB_TUI_TEST_MODE === '1',
    });
    return;
  }

  const result = await runCli(argv);
  if (!asJson && result.command === 'help') {
    process.stdout.write(`${renderHelpText()}\n`);
  } else if (!asJson && typeof result.text === 'string') {
    process.stdout.write(`${result.text}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
