import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('playlist_items')
    .select('*, media_assets(title, artist, duration_seconds, media_type, category)')
    .eq('playlist_id', params.id)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data });
}

// Add a media item to the end of the playlist
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { mediaAssetId, itemType } = await req.json();
  if (!mediaAssetId) return NextResponse.json({ error: 'mediaAssetId is required' }, { status: 400 });

  const supabase = getSupabaseServerClient();

  // Refuse to add anything marked Do Not Broadcast — enforced here as well
  // as at broadcast-start time, per the spec's "prevent ... added to a live
  // playlist" requirement.
  const { data: asset } = await supabase.from('media_assets').select('rights_status').eq('id', mediaAssetId).single();
  if (asset?.rights_status === 'do_not_broadcast') {
    return NextResponse.json({ error: 'This item is marked Do Not Broadcast and cannot be added to a playlist' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('playlist_items').select('position').eq('playlist_id', params.id)
    .order('position', { ascending: false }).limit(1);
  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase.from('playlist_items').insert({
    playlist_id: params.id, media_asset_id: mediaAssetId, position: nextPosition, item_type: itemType || 'song',
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data });
}

// Reorder (drag-and-drop drop event) and/or remove items in one batch call
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { orderedItemIds, removeItemId } = await req.json();
  const supabase = getSupabaseServerClient();

  if (removeItemId) {
    const { error } = await supabase.from('playlist_items').delete().eq('id', removeItemId).eq('playlist_id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (Array.isArray(orderedItemIds)) {
    await Promise.all(orderedItemIds.map((itemId: string, index: number) =>
      supabase.from('playlist_items').update({ position: index }).eq('id', itemId).eq('playlist_id', params.id)
    ));
  }

  return NextResponse.json({ ok: true });
}
