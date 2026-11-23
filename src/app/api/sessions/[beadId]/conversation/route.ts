import { NextResponse } from 'next/server';
import { activityEventBus } from '../../../../../lib/realtime';
import { getCommunicationSummary } from '../../../../../lib/agent-sessions';
import { readInteractionsViaBd } from '../../../../../lib/read-interactions';
import type { ActivityEvent } from '../../../../../lib/activity';
import type { AgentMessage } from '../../../../../lib/agent-mail';
import { getCurrentProjectRoot } from '../../../../../lib/current-project-root';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ beadId: string }> }
): Promise<Response> {
  const { beadId } = await params;
  const url = new URL(request.url);
  const projectRootSearchParam = url.searchParams.get('projectRoot');
  const projectRoot = projectRootSearchParam || getCurrentProjectRoot();

  try {
    // 1. Get activity events for this bead
    const history = activityEventBus.getHistory(projectRoot);
    const activity = history.filter((e: ActivityEvent) => e.beadId === beadId);

    // 2. Get communication for this bead
    const summary = await getCommunicationSummary(projectRoot);
    const messages = summary.messages.filter((m: AgentMessage) => m.bead_id === beadId);

    // 3. Get local bd interactions via CLI
    const beadInteractions = await readInteractionsViaBd(projectRoot, beadId);

    // 4. Merge and sort
    const thread = [
      ...activity.map((e: ActivityEvent) => ({
        type: 'activity' as const,
        id: e.id,
        timestamp: e.timestamp,
        data: e
      })),
      ...messages.map((m: AgentMessage) => ({
        type: 'message' as const,
        id: m.message_id,
        timestamp: m.created_at,
        data: m
      })),
      ...beadInteractions.map(i => ({
        type: 'interaction' as const,
        id: i.id,
        timestamp: i.timestamp,
        data: i
      }))
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return NextResponse.json({ ok: true, thread });
  } catch (error) {
    console.error('[API/Sessions/Conversation] Failed:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
