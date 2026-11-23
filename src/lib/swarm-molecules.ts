import { runBdCommand } from './bridge';
import { showAgent, type AgentRecord } from './agent-registry';
import { getCurrentProjectRoot } from './current-project-root';

export type SwarmCommandName = 'swarm join' | 'swarm leave' | 'swarm members';

export interface SwarmCommandError {
  code: string;
  message: string;
}

export interface SwarmCommandResponse<T> {
  ok: boolean;
  command: SwarmCommandName;
  data: T | null;
  error: SwarmCommandError | null;
}

export interface JoinSwarmInput {
  agent: string;
  epicId: string;
  projectRoot?: string;
}

export interface LeaveSwarmInput {
  agent: string;
  projectRoot?: string;
}

export interface SwarmMembersInput {
  swarmId: string;
  projectRoot?: string;
}

function invalid(command: SwarmCommandName, code: string, message: string): SwarmCommandResponse<never> {
  return { ok: false, command, data: null, error: { code, message } };
}

function success<T>(command: SwarmCommandName, data: T): SwarmCommandResponse<T> {
  return { ok: true, command, data, error: null };
}

function toBeadId(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith('bb-')) return trimmed;
  return `bb-${trimmed}`;
}

function fromBeadId(id: string): string {
  if (id.startsWith('bb-')) return id.slice(3);
  return id;
}

function extractJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON block found');
  return JSON.parse(text.slice(start, end + 1));
}

function extractJsonArray(text: string): any[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) {
    try { return [extractJson(text)]; } catch { return []; }
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function runBd(options: { projectRoot: string; args: string[]; timeoutMs?: number }) {
  const args = ['--allow-stale', ...options.args];
  return runBdCommand({
    projectRoot: options.projectRoot,
    args,
    timeoutMs: options.timeoutMs ?? 120000,
  });
}

async function verifyIssueExists(issueId: string, projectRoot: string): Promise<boolean> {
  const result = await runBd({ projectRoot, args: ['show', issueId, '--json'] });
  return result.success;
}

async function getSwarmLabels(beadId: string, projectRoot: string): Promise<string[]> {
  const result = await runBd({ projectRoot, args: ['show', beadId, '--json'] });
  if (!result.success) return [];
  try {
    const data = extractJson(result.stdout);
    return (data.labels || []).filter((l: string) => l.startsWith('swarm:'));
  } catch { return []; }
}

export async function joinSwarm(
  input: JoinSwarmInput,
  deps: { projectRoot?: string } = {}
): Promise<SwarmCommandResponse<AgentRecord>> {
  const command: SwarmCommandName = 'swarm join';
  const projectRoot = deps.projectRoot || getCurrentProjectRoot();
  const beadId = toBeadId(input.agent);

  const agentResult = await showAgent({ agent: input.agent }, { projectRoot });
  if (!agentResult.ok) {
    return invalid(command, 'AGENT_NOT_FOUND', `Agent '${input.agent}' is not registered.`);
  }

  const epicExists = await verifyIssueExists(input.epicId, projectRoot);
  if (!epicExists) {
    return invalid(command, 'EPIC_NOT_FOUND', `Issue '${input.epicId}' does not exist.`);
  }

  const swarmId = input.epicId;

  // Remove existing swarm labels (single-membership)
  const existingLabels = await getSwarmLabels(beadId, projectRoot);
  for (const oldLabel of existingLabels) {
    await runBd({ projectRoot, args: ['update', beadId, '--remove-label', oldLabel] });
  }

  // Add new swarm label
  const newLabel = `swarm:${swarmId}`;
  const updateResult = await runBd({ projectRoot, args: ['update', beadId, '--add-label', newLabel, '--json'] });
  if (!updateResult.success) {
    return invalid(command, 'INTERNAL_ERROR', `Failed to add swarm label: ${updateResult.error}`);
  }

  // Return updated agent record (showAgent uses bridge which now works)
  const updatedAgent = await showAgent({ agent: input.agent }, { projectRoot });
  if (!updatedAgent.ok) {
    return invalid(command, 'INTERNAL_ERROR', 'Failed to retrieve updated agent state.');
  }

  return success(command, updatedAgent.data!);
}

export async function leaveSwarm(
  input: LeaveSwarmInput,
  deps: { projectRoot?: string } = {}
): Promise<SwarmCommandResponse<AgentRecord>> {
  const command: SwarmCommandName = 'swarm leave';
  const projectRoot = deps.projectRoot || getCurrentProjectRoot();
  const beadId = toBeadId(input.agent);

  const agentResult = await showAgent({ agent: input.agent }, { projectRoot });
  if (!agentResult.ok) {
    return invalid(command, 'AGENT_NOT_FOUND', `Agent '${input.agent}' is not registered.`);
  }

  const swarmLabels = await getSwarmLabels(beadId, projectRoot);
  for (const label of swarmLabels) {
    await runBd({ projectRoot, args: ['update', beadId, '--remove-label', label] });
  }

  const updatedAgent = await showAgent({ agent: input.agent }, { projectRoot });
  if (!updatedAgent.ok) {
    return invalid(command, 'INTERNAL_ERROR', 'Failed to retrieve updated agent state.');
  }

  return success(command, updatedAgent.data!);
}

export async function getSwarmMembers(
  input: SwarmMembersInput,
  deps: { projectRoot?: string } = {}
): Promise<string[]> {
  const projectRoot = deps.projectRoot || getCurrentProjectRoot();

  const result = await runBd({ projectRoot, args: ['list', '--label', `swarm:${input.swarmId}`, '--json'] });
  if (!result.success) return [];

  const agents = extractJsonArray(result.stdout);
  return agents
    .filter((a: any) => a.labels?.includes('gt:agent'))
    .map((a: any) => fromBeadId(a.id));
}
