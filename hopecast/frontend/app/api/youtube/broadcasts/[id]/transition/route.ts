import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { getValidYoutubeAccessToken } from '@/lib/youtubeAuth';
import { transitionBroadcast } from '@/lib/youtubeApi';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { targetStatus } = await req.json(); // 'testing' | 'live' | 'complete'
  if (!['testing', 'live', 'complete'].includes(targetStatus)) {
    return NextResponse.json({ error: 'targetStatus must be testing, live, or complete' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: yb, error } = await supabase.from('youtube_broadcasts').select('*').eq('id', params.id).single();
  if (error || !yb) return NextResponse.json({ error: 'YouTube broadcast not found' }, { status: 404 });

  try {
    const accessToken = await getValidYoutubeAccessToken(yb.station_id);
    await transitionBroadcast(accessToken, yb.youtube_broadcast_id, targetStatus);
    await supabase.from('youtube_broadcasts').update({ lifecycle_status: targetStatus }).eq('id', params.id);

    if (targetStatus === 'complete') {
      const workerToken = jwt.sign(
        { sub: admin.id, role: admin.role },
        process.env.CONTROL_API_JWT_SECRET!,
        { algorithm: 'HS256', expiresIn: '2m' }
      );
      await fetch(`${process.env.STREAMING_WORKER_URL}/api/stream/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${workerToken}` },
      });
    }

    return NextResponse.json({ ok: true, lifecycleStatus: targetStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
