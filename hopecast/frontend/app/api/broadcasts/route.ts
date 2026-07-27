import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const stationId = req.nextUrl.searchParams.get('stationId');
  const id = req.nextUrl.searchParams.get('id');
  const supabase = getSupabaseServerClient();

  if (id) {
    const { data, error } = await supabase.from('broadcasts').select('*').eq('id', id).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ broadcast: data });
  }

  let query = supabase.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(100);
  if (stationId) query = query.eq('station_id', stationId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ broadcasts: data });
}
