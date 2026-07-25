import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const stationId = searchParams.get('stationId');
  const q = searchParams.get('q');
  const category = searchParams.get('category');
  const mediaType = searchParams.get('mediaType');
  const rightsStatus = searchParams.get('rightsStatus');

  const supabase = getSupabaseServerClient();
  let query = supabase.from('media_assets').select('*').order('created_at', { ascending: false });
  if (stationId) query = query.eq('station_id', stationId);
  if (category) query = query.eq('category', category);
  if (mediaType) query = query.eq('media_type', mediaType);
  if (rightsStatus) query = query.eq('rights_status', rightsStatus);
  if (q) query = query.or(`title.ilike.%${q}%,artist.ilike.%${q}%,album.ilike.%${q}%`);

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ media: data });
}

// Creates a brand-new media library entry (used right after a fresh upload)
export async function POST(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { stationId, title, artist, mediaType, category, storagePath, durationSeconds } = body;
  if (!stationId || !title || !mediaType || !storagePath) {
    return NextResponse.json({ error: 'stationId, title, mediaType, and storagePath are required' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('media_assets').insert({
    station_id: stationId,
    title,
    artist: artist || null,
    media_type: mediaType,
    category: category || null,
    storage_path: storagePath,
    duration_seconds: durationSeconds || null,
    rights_status: 'pending_review',
    active: true,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ media: data });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Added storage_path/title/artist/duration_seconds so "replace this file"
  // can be done from the upload UI, not just active/rights-status toggles.
  const allowed = ['active', 'rights_status', 'category', 'theme', 'notes', 'storage_path', 'title', 'artist', 'duration_seconds'];
  const update: Record<string, unknown> = {};
  for (const key of allowed) if (key in fields) update[key] = fields[key];

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('media_assets').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ media: data });
}
