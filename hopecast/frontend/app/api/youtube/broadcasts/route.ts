import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { getValidYoutubeAccessToken } from '@/lib/youtubeAuth';
import { createScheduledBroadcast } from '@/lib/youtubeApi';
import { encryptSecret } from '@/lib/crypto';

export async function POST(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { stationId, title, description, privacyStatus, scheduledStartTime } = await req.json();
  if (!stationId || !title || !scheduledStartTime) {
    return NextResponse.json({ error: 'stationId, title, and scheduledStartTime are required' }, { status: 400 });
  }

  try {
    const accessToken = await getValidYoutubeAccessToken(stationId);
    const result = await createScheduledBroadcast(accessToken, {
      title, description, privacyStatus: privacyStatus || 'unlisted', scheduledStartTime,
    });

    const supabase = getSupabaseServerClient();
    const { data: row, error } = await supabase.from('youtube_broadcasts').insert({
      station_id: stationId,
      youtube_broadcast_id: result.youtubeBroadcastId,
      youtube_stream_id: result.youtubeStreamId,
      title, description, privacy_status: privacyStatus || 'unlisted',
      scheduled_start_time: scheduledStartTime,
      lifecycle_status: 'created',
      ingestion_address: result.ingestionAddress,
      stream_key_encrypted: encryptSecret(result.streamName),
    }).select('id, youtube_broadcast_id, youtube_stream_id, title, scheduled_start_time, lifecycle_status').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ youtubeBroadcast: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
