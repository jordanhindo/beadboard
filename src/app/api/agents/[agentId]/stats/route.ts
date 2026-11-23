import { NextResponse } from 'next/server';
import path from 'node:path';
import { readIssuesFromDisk } from '../../../../../lib/read-issues';
import { activityEventBus } from '../../../../../lib/realtime';
import { getAgentMetrics } from '../../../../../lib/agent-sessions';
import { getCurrentProjectRoot } from '../../../../../lib/current-project-root';

export const dynamic = 'force-dynamic';

function isValidProjectRoot(root: string): boolean {
  try {
    const resolved = path.resolve(root);
    if (!path.isAbsolute(resolved)) {
      return false;
    }
    // Prevent path traversal by ensuring resolved path stays within the project root
    const allowedBase = getCurrentProjectRoot();
    const relative = path.relative(allowedBase, resolved);
    // If "resolved" is outside "allowedBase", "relative" will start with ".."
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
): Promise<Response> {
  const { agentId } = await params;
  const url = new URL(request.url);
  const projectRootParam = url.searchParams.get('projectRoot');
  const projectRoot = projectRootParam ?? getCurrentProjectRoot();

  if (projectRootParam && !isValidProjectRoot(projectRootParam)) {
    return NextResponse.json({ ok: false, error: 'Invalid projectRoot path' }, { status: 400 });
  }

  try {
    const issues = await readIssuesFromDisk({ projectRoot, preferBd: true });
    const activity = activityEventBus.getHistory(projectRoot);

    const metrics = await getAgentMetrics(agentId, issues, activity);

    return NextResponse.json({ ok: true, metrics });
  } catch (error) {
    console.error('[API/Agents/Stats] Failed:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
