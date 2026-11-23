import { NextResponse } from 'next/server';

import { runBdCommand } from '../../../../lib/bridge';
import { getCurrentProjectRoot } from '../../../../lib/current-project-root';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const projectRoot = searchParams.get('projectRoot') ?? getCurrentProjectRoot();

  const result = await runBdCommand({
    projectRoot,
    args: ['--version'],
    timeoutMs: 8_000,
  });

  if (!result.success) {
    const status = result.classification === 'not_found' ? 503 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: {
          classification: result.classification ?? 'unknown',
          message: result.error ?? result.stderr ?? 'bd health check failed',
        },
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      version: result.stdout,
    },
  });
}
