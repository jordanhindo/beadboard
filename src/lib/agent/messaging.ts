/**
 * Agent Messaging / Mail System
 * 
 * This module handles agent-to-agent coordination messages:
 * - sendAgentMessage: Send a message to another agent
 * - inboxAgentMessages: Retrieve messages for an agent
 * - readAgentMessage: Mark a message as read
 * - ackAgentMessage: Acknowledge a message (for HANDOFF/BLOCKED)
 */

import path from 'node:path';
import { runBdCommand } from '../bridge';
import {
  type SendAgentMessageInput,
  type SendAgentMessageDeps,
  type InboxAgentMessagesInput,
  type MessageActionInput,
  type MessageMutationDeps,
  type AgentMessage,
  type MailCommandName,
  type MailCommandError,
  type MailCommandResponse,
  type MessageCategory,
  type MessageState,
} from './types';
import { getCurrentProjectRoot } from '../current-project-root';

const MESSAGE_ID_PATTERN = /^msg_/;
const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function invalid<T>(command: MailCommandName, code: string, message: string): MailCommandResponse<T> {
  return { ok: false, command, data: null, error: { code, message } };
}

function success<T>(command: MailCommandName, data: T): MailCommandResponse<T> {
  return { ok: true, command, data, error: null };
}

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON block found in output');
  }
  const jsonPart = text.slice(start, end + 1);
  return JSON.parse(jsonPart);
}

function extractJsonArray(text: string): any[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) {
    try {
      const single = extractJson(text);
      return [single];
    } catch {
      return [];
    }
  }
  const jsonPart = text.slice(start, end + 1);
  return JSON.parse(jsonPart);
}

function toBeadId(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith('bb-')) return trimmed;
  return `bb-${trimmed}`;
}

async function getProjectRoot(deps: { projectRoot?: string }): Promise<string> {
  return deps.projectRoot || getCurrentProjectRoot();
}

async function verifyAgentExists(agent: string, projectRoot: string): Promise<boolean> {
  const beadId = toBeadId(agent);
  const result = await runBdCommand({
    projectRoot,
    args: ['show', beadId, '--json'],
  });
  return result.success;
}

function mapRawToAgentMessage(raw: any): AgentMessage {
  return {
    message_id: raw.message_id || raw.id || '',
    thread_id: raw.thread_id || raw.thread || '',
    bead_id: raw.bead_id || raw.bead || '',
    from_agent: raw.from_agent || raw.from || '',
    to_agent: raw.to_agent || raw.to || '',
    category: (raw.category as MessageCategory) || 'INFO',
    subject: raw.subject || '',
    body: raw.body || '',
    state: (raw.state as MessageState) || 'unread',
    requires_ack: raw.requires_ack ?? (raw.category === 'HANDOFF' || raw.category === 'BLOCKED'),
    created_at: raw.created_at || raw.created_at || '',
    read_at: raw.read_at || null,
    acked_at: raw.acked_at || null,
  };
}

export async function sendAgentMessage(
  input: SendAgentMessageInput,
  deps?: Partial<SendAgentMessageDeps> & { projectRoot?: string },
): Promise<MailCommandResponse<AgentMessage>> {
  const command: MailCommandName = 'agent send';
  const projectRoot = await getProjectRoot(deps || {});
  const now = deps?.now || (() => new Date().toISOString());
  const idGenerator = deps?.idGenerator || (() => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  const from = trimOrEmpty(input.from);
  const to = trimOrEmpty(input.to);
  const bead = trimOrEmpty(input.bead);
  const category = input.category;
  const subject = trimOrEmpty(input.subject);
  const body = trimOrEmpty(input.body);
  const thread = trimOrEmpty(input.thread);

  if (!from) {
    return invalid(command, 'INVALID_INPUT', 'Sender agent is required.');
  }
  if (!to) {
    return invalid(command, 'INVALID_INPUT', 'Recipient agent is required.');
  }
  if (!bead) {
    return invalid(command, 'INVALID_INPUT', 'Bead ID is required.');
  }
  if (!category) {
    return invalid(command, 'INVALID_INPUT', 'Category is required.');
  }
  if (!subject) {
    return invalid(command, 'INVALID_INPUT', 'Subject is required.');
  }
  if (!body) {
    return invalid(command, 'INVALID_INPUT', 'Body is required.');
  }

  const fromExists = await verifyAgentExists(from, projectRoot);
  if (!fromExists) {
    return invalid(command, 'UNKNOWN_SENDER', `Sender agent '${from}' is not registered.`);
  }

  const toExists = await verifyAgentExists(to, projectRoot);
  if (!toExists) {
    return invalid(command, 'UNKNOWN_RECIPIENT', `Recipient agent '${to}' is not registered.`);
  }

  const validCategories = ['HANDOFF', 'BLOCKED', 'DECISION', 'INFO'];
  if (!validCategories.includes(category)) {
    return invalid(command, 'INVALID_CATEGORY', `Category must be one of: ${validCategories.join(', ')}`);
  }

  try {
    const messageId = idGenerator();
    const threadId = thread || `thread_${now().replace(/[-:]/g, '').replace('T', '_').split('.')[0]}`;
    const requiresAck = category === 'HANDOFF' || category === 'BLOCKED';

    const commentArgs = [
      'comment',
      bead,
      '--author', from,
      '--body', JSON.stringify({ message_id: messageId, thread_id: threadId, from_agent: from, to_agent: to, category, subject, body, requires_ack: requiresAck, created_at: now() }),
    ];

    const result = await runBdCommand({
      projectRoot,
      args: [...commentArgs, '--json'],
    });

    if (!result.success) {
      return invalid(command, 'INTERNAL_ERROR', `Failed to send message: ${result.error}`);
    }

    const message: AgentMessage = {
      message_id: messageId,
      thread_id: threadId,
      bead_id: bead,
      from_agent: from,
      to_agent: to,
      category,
      subject,
      body,
      state: 'unread',
      requires_ack: requiresAck,
      created_at: now(),
      read_at: null,
      acked_at: null,
    };

    return success(command, message);
  } catch (error) {
    return invalid(command, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Failed to send message.');
  }
}

export async function inboxAgentMessages(
  input: InboxAgentMessagesInput,
  deps: { projectRoot?: string } = {},
): Promise<MailCommandResponse<AgentMessage[]>> {
  const command: MailCommandName = 'agent inbox';
  const projectRoot = await getProjectRoot(deps);

  const agent = trimOrEmpty(input.agent);
  if (!agent) {
    return invalid(command, 'INVALID_INPUT', 'Agent name is required.');
  }

  const agentExists = await verifyAgentExists(agent, projectRoot);
  if (!agentExists) {
    return invalid(command, 'UNKNOWN_AGENT', `Agent '${agent}' is not registered.`);
  }

  try {
    const listResult = await runBdCommand({
      projectRoot,
      args: ['list', '--author', toBeadId(agent), '--json'],
    });

    if (!listResult.success) {
      return invalid(command, 'INTERNAL_ERROR', `Failed to list messages: ${listResult.error}`);
    }

    const rawList = extractJsonArray(listResult.stdout);
    const messages: AgentMessage[] = [];

    for (const item of rawList) {
      try {
        const commentBody = JSON.parse(item.body || '{}');
        if (commentBody.to_agent === agent || commentBody.from_agent === agent) {
          if (input.state && commentBody.state !== input.state) continue;
          if (input.bead && commentBody.bead_id !== input.bead) continue;

          const msg = mapRawToAgentMessage(commentBody);
          if (msg.to_agent === agent) {
            messages.push(msg);
          }
        }
      } catch {
        // Skip non-message comments
      }
    }

    if (input.limit && messages.length > input.limit) {
      messages.length = input.limit;
    }

    return success(command, messages);
  } catch (error) {
    return invalid(command, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Failed to retrieve inbox.');
  }
}

export async function readAgentMessage(
  input: MessageActionInput,
  deps?: Partial<MessageMutationDeps> & { projectRoot?: string },
): Promise<MailCommandResponse<AgentMessage>> {
  const command: MailCommandName = 'agent read';
  const projectRoot = await getProjectRoot(deps || {});
  const now = deps?.now || (() => new Date().toISOString());

  const agent = trimOrEmpty(input.agent);
  const messageId = trimOrEmpty(input.message);

  if (!agent) {
    return invalid(command, 'INVALID_INPUT', 'Agent name is required.');
  }
  if (!messageId) {
    return invalid(command, 'INVALID_INPUT', 'Message ID is required.');
  }

  const agentExists = await verifyAgentExists(agent, projectRoot);
  if (!agentExists) {
    return invalid(command, 'UNKNOWN_AGENT', `Agent '${agent}' is not registered.`);
  }

  try {
    const listResult = await runBdCommand({
      projectRoot,
      args: ['list', '--author', toBeadId(agent), '--json'],
    });

    if (!listResult.success) {
      return invalid(command, 'INTERNAL_ERROR', `Failed to find message: ${listResult.error}`);
    }

    const rawList = extractJsonArray(listResult.stdout);
    let foundMessage: any = null;
    let foundBead = '';

    for (const item of rawList) {
      try {
        const commentBody = JSON.parse(item.body || '{}');
        if (commentBody.message_id === messageId && commentBody.to_agent === agent) {
          foundMessage = commentBody;
          foundBead = item.id;
          break;
        }
      } catch {
        // Skip
      }
    }

    if (!foundMessage) {
      return invalid(command, 'MESSAGE_NOT_FOUND', `Message '${messageId}' not found for agent '${agent}'.`);
    }

    if (foundMessage.state === 'read' || foundMessage.state === 'acked') {
      return invalid(command, 'ALREADY_READ', 'Message is already read or acknowledged.');
    }

    const updatedMessage = {
      ...foundMessage,
      state: 'read' as MessageState,
      read_at: now(),
    };

    const commentArgs = [
      'comment',
      foundBead,
      '--author', agent,
      '--body', JSON.stringify(updatedMessage),
    ];

    const updateResult = await runBdCommand({
      projectRoot,
      args: [...commentArgs, '--json'],
    });

    if (!updateResult.success) {
      return invalid(command, 'INTERNAL_ERROR', `Failed to mark message as read: ${updateResult.error}`);
    }

    const message = mapRawToAgentMessage(updatedMessage);

    return success(command, message);
  } catch (error) {
    return invalid(command, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Failed to read message.');
  }
}

export async function ackAgentMessage(
  input: MessageActionInput,
  deps?: Partial<MessageMutationDeps> & { projectRoot?: string },
): Promise<MailCommandResponse<AgentMessage>> {
  const command: MailCommandName = 'agent ack';
  const projectRoot = await getProjectRoot(deps || {});
  const now = deps?.now || (() => new Date().toISOString());

  const agent = trimOrEmpty(input.agent);
  const messageId = trimOrEmpty(input.message);

  if (!agent) {
    return invalid(command, 'INVALID_INPUT', 'Agent name is required.');
  }
  if (!messageId) {
    return invalid(command, 'INVALID_INPUT', 'Message ID is required.');
  }

  const agentExists = await verifyAgentExists(agent, projectRoot);
  if (!agentExists) {
    return invalid(command, 'UNKNOWN_AGENT', `Agent '${agent}' is not registered.`);
  }

  try {
    const listResult = await runBdCommand({
      projectRoot,
      args: ['list', '--author', toBeadId(agent), '--json'],
    });

    if (!listResult.success) {
      return invalid(command, 'INTERNAL_ERROR', `Failed to find message: ${listResult.error}`);
    }

    const rawList = extractJsonArray(listResult.stdout);
    let foundMessage: any = null;
    let foundBead = '';

    for (const item of rawList) {
      try {
        const commentBody = JSON.parse(item.body || '{}');
        if (commentBody.message_id === messageId && commentBody.to_agent === agent) {
          foundMessage = commentBody;
          foundBead = item.id;
          break;
        }
      } catch {
        // Skip
      }
    }

    if (!foundMessage) {
      return invalid(command, 'MESSAGE_NOT_FOUND', `Message '${messageId}' not found for agent '${agent}'.`);
    }

    if (foundMessage.to_agent !== agent) {
      return invalid(command, 'ACK_FORBIDDEN', 'Only the recipient can acknowledge this message.');
    }

    if (!foundMessage.requires_ack) {
      return invalid(command, 'ACK_NOT_REQUIRED', 'This message does not require acknowledgment.');
    }

    if (foundMessage.state === 'acked') {
      return invalid(command, 'ALREADY_ACKED', 'Message is already acknowledged.');
    }

    const updatedMessage = {
      ...foundMessage,
      state: 'acked' as MessageState,
      acked_at: now(),
    };

    const commentArgs = [
      'comment',
      foundBead,
      '--author', agent,
      '--body', JSON.stringify(updatedMessage),
    ];

    const updateResult = await runBdCommand({
      projectRoot,
      args: [...commentArgs, '--json'],
    });

    if (!updateResult.success) {
      return invalid(command, 'INTERNAL_ERROR', `Failed to acknowledge message: ${updateResult.error}`);
    }

    const message = mapRawToAgentMessage(updatedMessage);

    return success(command, message);
  } catch (error) {
    return invalid(command, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Failed to acknowledge message.');
  }
}
