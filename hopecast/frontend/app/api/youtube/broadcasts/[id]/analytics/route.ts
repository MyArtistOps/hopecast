import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { getValidYoutubeAccessToken } from '@/lib/youtubeAuth';
import { getLiveAnalytics } from '@/lib/youtubeApi';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = getSupabaseServerClient();
  const { data: yb, error } = await supabase.from('youtube_broadcasts').select('*').eq('id', params.id).single();
  if (error || !yb) return NextResponse.json({ error: 'YouTube broadcast not found' }, { status: 404 });

  const { data: dest } = await supabase
    .from('stream_destinations').select('youtube_channel_id')
    .eq('station_id', yb.station_id).eq('platform', 'youtube').single();

  if (!dest?.youtube_channel_id) {
    return NextResponse.json({ available: false, reason: 'Requires YouTube API Connection' });
  }

  try {
    const accessToken = await getValidYoutubeAccessToken(yb.station_id);
    const analytics = await getLiveAnalytics(accessToken, dest.youtube_channel_id, yb.youtube_broadcast_id);
    return NextResponse.json(analytics);
  } catch {
    return NextResponse.json({ available: false, reason: 'Requires YouTube API Connection' });
  }
}
