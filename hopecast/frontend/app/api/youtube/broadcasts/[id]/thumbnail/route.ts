import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { getValidYoutubeAccessToken } from '@/lib/youtubeAuth';
import { setThumbnail } from '@/lib/youtubeApi';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('thumbnail') as File | null;
  if (!file) return NextResponse.json({ error: 'A thumbnail file is required' }, { status: 400 });
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return NextResponse.json({ error: 'Thumbnail must be JPEG or PNG' }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'Thumbnail must be under 2MB (YouTube limit)' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: yb, error } = await supabase.from('youtube_broadcasts').select('*').eq('id', params.id).single();
  if (error || !yb) return NextResponse.json({ error: 'YouTube broadcast not found' }, { status: 404 });

  try {
    const accessToken = await getValidYoutubeAccessToken(yb.station_id);
    const buffer = Buffer.from(await file.arrayBuffer());
    await setThumbnail(accessToken, yb.youtube_broadcast_id, buffer, file.type);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
