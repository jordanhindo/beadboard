import fs from 'node:fs/promises';
import path from 'node:path';

import { canonicalizeWindowsPath } from '../../../lib/pathing';
import { issuesEventBus, activityEventBus, SSE_CONNECTED_FRAME, SSE_HEARTBEAT_FRAME, toSseFrame, toActivitySseFrame } from '../../../lib/realtime';
import { getIssuesWatchManager } from '../../../lib/watcher';
import { getCurrentProjectRoot } from '../../../lib/current-project-root';

const encoder = new TextEncoder();
const HEARTBEAT_MS = 15_000;
const LAST_TOUCHED_POLL_MS = 1_000;

async function readLastTouchedVersion(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    // Log non-ENOENT errors but don't swallow them silently
    console.error('[Events] Failed to read last-touched version:', error);
    return null;
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectRootSearchParam = url.searchParams.get('projectRoot');
  const projectRoot = canonicalizeWindowsPath(projectRootSearchParam || getCurrentProjectRoot());

  console.log(`[SSE /api/events] Connection request - raw param: "${projectRootSearchParam}", canonicalized: "${projectRoot}"`);

  try {
    getIssuesWatchManager().startWatch(projectRoot);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          classification: 'unknown',
          message: error instanceof Error ? error.message : 'Failed to initialize watcher.',
        },
      },
      { status: 500 },
    );
  }

  let cleanup = () => { };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (payload: string) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(payload));
      };

      write(SSE_CONNECTED_FRAME);

      console.log(`[SSE /api/events] Subscribing to event bus with projectRoot: ${projectRoot}`);
      const unsubscribeIssues = issuesEventBus.subscribe(
        (event) => {
          console.log('[SSE /api/events] Received ISSUES event from bus:', event.kind, 'projectRoot:', event.projectRoot);
          write(toSseFrame(event));
        },
        { projectRoot },
      );

      console.log(`[SSE /api/events] Subscriber count after subscribe: ${issuesEventBus.getSubscriberCount()}`);

      const unsubscribeActivity = activityEventBus.subscribe(
        (event) => {
          console.log('[SSE /api/events] Received ACTIVITY event from bus');
          write(toActivitySseFrame(event));
        },
        { projectRoot },
      );

      const heartbeat = setInterval(() => {
        write(SSE_HEARTBEAT_FRAME);
      }, HEARTBEAT_MS);
      const lastTouchedPath = path.join(projectRoot, '.beads', 'last-touched');
      let lastTouchedVersion: number | null = null;

      let isPolling = false;
      const pollLastTouched = async () => {
        if (isPolling) {
          return;
        }
        isPolling = true;
        try {
          const nextVersion = await readLastTouchedVersion(lastTouchedPath);
          if (nextVersion === null) {
            return;
          }
          if (lastTouchedVersion === null) {
            lastTouchedVersion = nextVersion;
            return;
          }
          if (nextVersion !== lastTouchedVersion) {
            lastTouchedVersion = nextVersion;
            write(toSseFrame(issuesEventBus.emit(projectRoot, lastTouchedPath, 'telemetry')));
          }
        } finally {
          isPolling = false;
        }
      };

      const touchedPoll = setInterval(() => {
        void pollLastTouched();
      }, LAST_TOUCHED_POLL_MS);
      void pollLastTouched();

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);
        clearInterval(touchedPoll);
        unsubscribeIssues();
        unsubscribeActivity();
        request.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };
      cleanup = close;

      request.signal.addEventListener('abort', close);
    },
    cancel() {
      // Called when client closes EventSource/reader.
      // Ensures heartbeat + subscriber cleanup always runs.
      cleanup();
      return Promise.resolve();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}