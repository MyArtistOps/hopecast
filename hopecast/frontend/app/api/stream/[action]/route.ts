import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { requireAdminSession } from '@/lib/supabaseServer';

// Proxies dashboard button clicks (Start/Stop/Restart/Emergency Stop/Status/Logs)
// to the streaming worker's control API. The stream key, worker JWT secret,
// and worker URL all stay server-side; the browser only ever talks to this
// Next.js route with its normal Supabase session cookie.

const ALLOWED_ACTIONS = new Set([
  'status', 'logs', 'prepare', 'start', 'start-audio-queue', 'now-playing',
  'stop', 'restart', 'emergency-stop', 'test-connection',
]);

const READ_ONLY_ACTIONS = new Set(['status', 'logs', 'now-playing']);

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!ALLOWED_ACTIONS.has(params.action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const workerToken = jwt.sign(
    { sub: admin.id, role: admin.role },
    process.env.CONTROL_API_JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '2m' }
  );

  const isReadOnly = READ_ONLY_ACTIONS.has(params.action);
  const body = isReadOnly ? undefined : await req.text();

  const upstream = await fetch(`${process.env.STREAMING_WORKER_URL}/api/stream/${params.action}`, {
    method: isReadOnly ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  // Convenience for status/logs polling from the dashboard
  return POST(req, { params });
}
