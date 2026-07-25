import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { decryptSecret } from '@/lib/crypto';

// Bridges Milestone 6 back into the Milestone 1-5 worker: decrypts the
// YouTube-issued RTMPS key here, server-side, and hands it directly to the
// worker's own start endpoint. The key is never written back to any
// broadcast row in plaintext and never appears in a response to the browser.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { mode, workerBroadcastId, sourcePath, playlistId } = await req.json();
  if (!workerBroadcastId) return NextResponse.json({ error: 'workerBroadcastId is required' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: yb, error } = await supabase.from('youtube_broadcasts').select('*').eq('id', params.id).single();
  if (error || !yb) return NextResponse.json({ error: 'YouTube broadcast not found' }, { status: 404 });

  const streamKey = decryptSecret(yb.stream_key_encrypted);
  const workerToken = jwt.sign(
    { sub: admin.id, role: admin.role },
    process.env.CONTROL_API_JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '2m' }
  );

  const action = mode === 'mode2_static_audio' ? 'start-audio-queue' : 'start';
  const body = mode === 'mode2_static_audio'
    ? { broadcastId: workerBroadcastId, playlistId, destinationUrl: yb.ingestion_address, streamKey }
    : { broadcastId: workerBroadcastId, mode: 'mode1_video_loop', sourcePath, destinationUrl: yb.ingestion_address, streamKey };

  const upstream = await fetch(`${process.env.STREAMING_WORKER_URL}/api/stream/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();

  if (upstream.ok) {
    await supabase.from('youtube_broadcasts').update({ lifecycle_status: 'testing', broadcast_id: workerBroadcastId }).eq('id', params.id);
  }

  return NextResponse.json(data, { status: upstream.status });
}
