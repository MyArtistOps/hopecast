import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getSupabaseServerClient, requireAdminSession } from '@/lib/supabaseServer';
import { exchangeCodeForTokens, getMyChannel } from '@/lib/youtubeApi';
import { encryptSecret } from '@/lib/crypto';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.redirect(new URL('/login', req.url));

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard/settings?youtube_error=missing_code', req.url));
  }

  let stationId: string;
  try {
    const payload = jwt.verify(state, process.env.CONTROL_API_JWT_SECRET!) as { stationId: string };
    stationId = payload.stationId;
  } catch {
    return NextResponse.redirect(new URL('/dashboard/settings?youtube_error=invalid_state', req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token on first consent (or with
      // prompt=consent, which we always send) — if it's still missing,
      // surface a clear error instead of silently storing a token that
      // will stop working in an hour.
      throw new Error('Google did not return a refresh token. Try disconnecting the app at myaccount.google.com/permissions and reconnecting.');
    }

    const channel = await getMyChannel(tokens.access_token);
    const supabase = getSupabaseServerClient();

    const { data: existing } = await supabase
      .from('stream_destinations')
      .select('id')
      .eq('station_id', stationId)
      .eq('platform', 'youtube')
      .limit(1)
      .single();

    const row = {
      station_id: stationId,
      platform: 'youtube',
      destination_name: channel.title,
      server_url: 'resolved-per-broadcast', // Milestone 6 issues a fresh RTMPS endpoint per scheduled broadcast
      encrypted_stream_key_reference: 'resolved-per-broadcast',
      youtube_channel_id: channel.id,
      youtube_channel_title: channel.title,
      oauth_refresh_token_encrypted: encryptSecret(tokens.refresh_token),
      oauth_access_token_encrypted: encryptSecret(tokens.access_token),
      oauth_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      oauth_connected_at: new Date().toISOString(),
      enabled: true,
    };

    if (existing) {
      await supabase.from('stream_destinations').update(row).eq('id', existing.id);
    } else {
      await supabase.from('stream_destinations').insert(row);
    }

    return NextResponse.redirect(new URL('/dashboard/settings?youtube_connected=1', req.url));
  } catch (err: any) {
    return NextResponse.redirect(new URL(`/dashboard/settings?youtube_error=${encodeURIComponent(err.message)}`, req.url));
  }
}
