import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const stationId = req.nextUrl.searchParams.get('stationId');
  const supabase = getSupabaseServerClient();
  let query = supabase.from('playlists').select('*').order('updated_at', { ascending: false });
  if (stationId) query = query.eq('station_id', stationId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ playlists: data });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { stationId, name, loopEnabled } = await req.json();
  if (!stationId || !name) return NextResponse.json({ error: 'stationId and name are required' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('playlists').insert({
    station_id: stationId, name, loop_enabled: loopEnabled ?? true, status: 'draft',
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ playlist: data });
}
