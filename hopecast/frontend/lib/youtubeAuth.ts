import { getSupabaseServerClient } from './supabaseServer';
import { encryptSecret, decryptSecret } from './crypto';
import { refreshAccessToken } from './youtubeApi';

/**
 * Returns a currently-valid access token for the station's connected YouTube
 * channel, transparently refreshing (and re-encrypting/persisting) it if
 * expired. Throws if the station hasn't connected YouTube yet.
 */
export async function getValidYoutubeAccessToken(stationId: string) {
  const supabase = getSupabaseServerClient();
  const { data: dest, error } = await supabase
    .from('stream_destinations')
    .select('*')
    .eq('station_id', stationId)
    .eq('platform', 'youtube')
    .not('oauth_refresh_token_encrypted', 'is', null)
    .limit(1)
    .single();

  if (error || !dest) throw new Error('This station has not connected a YouTube channel yet');

  const expiresAt = dest.oauth_token_expires_at ? new Date(dest.oauth_token_expires_at).getTime() : 0;
  const stillValid = dest.oauth_access_token_encrypted && expiresAt > Date.now() + 60_000;

  if (stillValid) return decryptSecret(dest.oauth_access_token_encrypted);

  const refreshToken = decryptSecret(dest.oauth_refresh_token_encrypted);
  const { access_token, expires_in } = await refreshAccessToken(refreshToken);

  await supabase.from('stream_destinations').update({
    oauth_access_token_encrypted: encryptSecret(access_token),
    oauth_token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
  }).eq('id', dest.id);

  return access_token;
}
