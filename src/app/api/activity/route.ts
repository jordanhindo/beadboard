import { NextResponse } from 'next/server';
import path from 'node:path';
import { activityEventBus } from '../../../lib/realtime';
import { getCurrentProjectRoot } from '../../../lib/current-project-root';

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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectRootParam = url.searchParams.get('projectRoot');
  
  if (projectRootParam && !isValidProjectRoot(projectRootParam)) {
    return NextResponse.json(
      { error: 'Invalid projectRoot path' },
      { status: 400 }
    );
  }

  const projectRoot = projectRootParam || undefined;
  const history = activityEventBus.getHistory(projectRoot);

  return Response.json(history);
}
