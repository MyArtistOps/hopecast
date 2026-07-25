import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const stationId = req.nextUrl.searchParams.get('stationId');
  const supabase = getSupabaseServerClient();
  let query = supabase.from('stations').select('*');
  query = stationId ? query.eq('id', stationId) : query.eq('enabled', true).limit(1);

  const { data, error } = await query.single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ station: data });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id, backgroundUrl } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('stations')
    .update({ background_url: backgroundUrl })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ station: data });
}
