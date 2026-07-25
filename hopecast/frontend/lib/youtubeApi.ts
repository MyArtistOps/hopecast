// Server-only. Thin, dependency-free wrapper around the two Google APIs
// this module needs: OAuth 2.0 token exchange and the YouTube Data API v3.
// Kept intentionally minimal — this is the "future YouTube integration"
// module the spec says must not delay or destabilize the RTMPS MVP, so it
// has no shared code paths with the streaming worker beyond the values it
// hands back (title/description/RTMPS ingestion address/key).

const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

export function getGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent', // ensures a refresh_token is returned even on repeat connects
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function ytFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`YouTube API error (${path}): ${await res.text()}`);
  return res.json();
}

export async function getMyChannel(accessToken: string) {
  const data = await ytFetch(accessToken, 'channels?part=snippet&mine=true');
  const channel = data.items?.[0];
  if (!channel) throw new Error('No YouTube channel found for this Google account');
  return { id: channel.id as string, title: channel.snippet.title as string };
}

export async function createScheduledBroadcast(accessToken: string, {
  title, description, privacyStatus, scheduledStartTime,
}: { title: string; description?: string; privacyStatus: 'public' | 'unlisted' | 'private'; scheduledStartTime: string }) {
  const broadcast = await ytFetch(accessToken, 'liveBroadcasts?part=snippet,status,contentDetails', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title, description: description || '', scheduledStartTime },
      status: { privacyStatus },
      contentDetails: { enableAutoStart: false, enableAutoStop: false },
    }),
  });

  // Create a fresh RTMPS ingestion stream for this broadcast rather than
  // reusing a persistent one, so a leaked/rotated key never affects a past
  // or future broadcast.
  const stream = await ytFetch(accessToken, 'liveStreams?part=snippet,cdn,contentDetails', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title: `${title} — stream` },
      cdn: { frameRate: '30fps', resolution: '720p', ingestionType: 'rtmp' },
      contentDetails: { isReusable: false },
    }),
  });

  await ytFetch(accessToken, `liveBroadcasts/bind?id=${broadcast.id}&part=id,contentDetails&streamId=${stream.id}`, {
    method: 'POST',
  });

  return {
    youtubeBroadcastId: broadcast.id as string,
    youtubeStreamId: stream.id as string,
    ingestionAddress: stream.cdn.ingestionInfo.ingestionAddress as string,
    streamName: stream.cdn.ingestionInfo.streamName as string, // this IS the stream key
  };
}

export async function transitionBroadcast(accessToken: string, youtubeBroadcastId: string, status: 'testing' | 'live' | 'complete') {
  return ytFetch(accessToken, `liveBroadcasts/transition?broadcastStatus=${status}&id=${youtubeBroadcastId}&part=id,status`, {
    method: 'POST',
  });
}

export async function getBroadcastStatus(accessToken: string, youtubeBroadcastId: string) {
  const data = await ytFetch(accessToken, `liveBroadcasts?part=status,snippet&id=${youtubeBroadcastId}`);
  return data.items?.[0] || null;
}

export async function setThumbnail(accessToken: string, videoId: string, imageBuffer: Buffer, mimeType: string) {
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
    body: body: imageBuffer as any,,
  });
  if (!res.ok) throw new Error(`Thumbnail upload failed: ${await res.text()}`);
  return res.json();
}

/**
 * Best-effort live analytics. Several metrics (concurrent viewers, watch
 * time) require the YouTube Analytics API and, for some, channel
 * eligibility the account may not have. Per spec: label anything that
 * comes back empty/unauthorized as "Requires YouTube API Connection"
 * rather than guessing.
 */
export async function getLiveAnalytics(accessToken: string, channelId: string, videoId: string) {
  try {
    const params = new URLSearchParams({
      ids: `channel==${channelId}`,
      metrics: 'estimatedMinutesWatched,views,likes,subscribersGained',
      dimensions: 'video',
      filters: `video==${videoId}`,
    });
    const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { available: false, reason: 'Requires YouTube API Connection' };
    const data = await res.json();
    const row = data.rows?.[0];
    if (!row) return { available: false, reason: 'No data yet for this broadcast' };
    return {
      available: true,
      estimatedMinutesWatched: row[1], views: row[2], likes: row[3], subscribersGained: row[4],
    };
  } catch {
    return { available: false, reason: 'Requires YouTube API Connection' };
  }
}
