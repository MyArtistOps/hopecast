import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const stationId = req.nextUrl.searchParams.get('stationId');
  const supabase = getSupabaseServerClient();
  let query = supabase.from('schedules').select('*').order('start_at', { ascending: true });
  if (stationId) query = query.eq('station_id', stationId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ schedules: data });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const {
    stationId, playlistId, title, startAt, endAt, timezone,
    recurrenceType, daysOfWeek, autoStart, autoStop, autoRestart,
  } = body;

  if (!stationId || !title || !startAt) {
    return NextResponse.json({ error: 'stationId, title, and startAt are required' }, { status: 400 });
  }

  const recurrence_rule = recurrenceType === 'weekly'
    ? JSON.stringify({ type: 'weekly', daysOfWeek: daysOfWeek || [] })
    : JSON.stringify({ type: 'none' });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('schedules').insert({
    station_id: stationId,
    playlist_id: playlistId || null,
    title,
    start_at: startAt,
    end_at: endAt || null,
    timezone: timezone || 'America/New_York',
    recurrence_rule,
    auto_start: autoStart ?? true,
    auto_stop: autoStop ?? true,
    auto_restart: autoRestart ?? true,
    status: 'scheduled',
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ schedule: data });
}
