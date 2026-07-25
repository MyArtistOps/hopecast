import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { getValidYoutubeAccessToken } from '@/lib/youtubeAuth';
import { getBroadcastStatus } from '@/lib/youtubeApi';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = getSupabaseServerClient();
  const { data: yb, error } = await supabase.from('youtube_broadcasts').select('*').eq('id', params.id).single();
  if (error || !yb) return NextResponse.json({ error: 'YouTube broadcast not found' }, { status: 404 });

  try {
    const accessToken = await getValidYoutubeAccessToken(yb.station_id);
    const status = await getBroadcastStatus(accessToken, yb.youtube_broadcast_id);
    return NextResponse.json({
      lifeCycleStatus: status?.status?.lifeCycleStatus || 'unknown',
      privacyStatus: status?.status?.privacyStatus,
      title: status?.snippet?.title,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
