import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = getSupabaseServerClient();

  const { data: events, error } = await supabase
    .from('broadcast_events')
    .select('*')
    .eq('broadcast_id', params.id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const itemChanges = (events || []).filter((e) => e.event_type === 'item_change');
  const assetIds = [...new Set(itemChanges.map((e) => e.metadata?.mediaAssetId).filter(Boolean))];

  let mediaTypeById: Record<string, string> = {};
  if (assetIds.length > 0) {
    const { data: assets } = await supabase.from('media_assets').select('id, media_type').in('id', assetIds);
    mediaTypeById = Object.fromEntries((assets || []).map((a) => [a.id, a.media_type]));
  }

  const counts = { songs: 0, station_ids: 0, promos: 0, other: 0 };
  for (const e of itemChanges) {
    const type = mediaTypeById[e.metadata?.mediaAssetId];
    if (type === 'station_id') counts.station_ids += 1;
    else if (type === 'advertisement' || type === 'announcement') counts.promos += 1;
    else if (type === 'audio' || type === 'video') counts.songs += 1;
    else counts.other += 1;
  }

  const restarts = (events || []).filter((e) => e.event_type === 'preparing').length;
  const errors = (events || []).filter((e) => e.event_type === 'error');

  return NextResponse.json({
    totalItemsPlayed: itemChanges.length,
    counts,
    restartEvents: restarts,
    errors: errors.map((e) => ({ message: e.message, at: e.created_at })),
    events,
  });
}
