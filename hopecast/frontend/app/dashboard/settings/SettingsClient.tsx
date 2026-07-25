'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Destination = {
  id: string;
  destination_name: string | null;
  youtube_channel_title: string | null;
  oauth_connected_at: string | null;
  enabled: boolean;
} | null;

export default function SettingsClient({ stationId, destination }: { stationId: string; destination: Destination }) {
  const searchParams = useSearchParams();
  const youtubeError = searchParams.get('youtube_error');
  const justConnected = searchParams.get('youtube_connected');

  const [title, setTitle] = useState('Delana Hope Weekend Radio — Live');
  const [scheduledStartTime, setScheduledStartTime] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'unlisted' | 'public' | 'private'>('unlisted');
  const [creating, setCreating] = useState(false);
  const [ytBroadcast, setYtBroadcast] = useState<any>(null);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/youtube/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, title, privacyStatus, scheduledStartTime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setYtBroadcast(data.youtubeBroadcast);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const goLive = async (targetStatus: 'testing' | 'live' | 'complete') => {
    if (!ytBroadcast) return;
    const res = await fetch(`/api/youtube/broadcasts/${ytBroadcast.id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStatus }),
    });
    const data = await res.json();
    if (res.ok) setLiveStatus(data.lifecycleStatus);
    else setError(data.error);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-semibold text-gold">Stream Destination Settings</h1>

      {youtubeError && <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-md p-3">{decodeURIComponent(youtubeError)}</p>}
      {justConnected && <p className="text-green-400 text-sm">YouTube channel connected successfully.</p>}

      <section className="bg-panel border border-gold/30 rounded-xl p-6 space-y-3">
        <h2 className="font-medium text-gold/90">YouTube Channel</h2>
        {destination?.oauth_connected_at ? (
          <p className="text-sm text-cream/70">
            Connected: <span className="text-cream">{destination.youtube_channel_title}</span>
          </p>
        ) : (
          <>
            <p className="text-sm text-cream/60">No YouTube channel connected yet. Connecting enables auto-created scheduled broadcasts, titles/descriptions, thumbnails, and live status/analytics — the manual RTMPS-paste flow from earlier milestones still works without this.</p>
            <a href={`/api/youtube/connect?stationId=${stationId}`}
              className="inline-block rounded-md bg-gold text-base font-medium px-4 py-2 text-sm">
              Connect YouTube Channel
            </a>
          </>
        )}
      </section>

      {destination?.oauth_connected_at && (
        <section className="bg-panel border border-gold/30 rounded-xl p-6 space-y-4">
          <h2 className="font-medium text-gold/90">Create Scheduled Broadcast</h2>
          <form onSubmit={createBroadcast} className="space-y-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Broadcast title"
              className="w-full rounded-md bg-base border border-gold/20 px-3 py-2 text-sm" />
            <input type="datetime-local" required value={scheduledStartTime} onChange={(e) => setScheduledStartTime(e.target.value)}
              className="w-full rounded-md bg-base border border-gold/20 px-3 py-2 text-sm" />
            <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value as any)}
              className="w-full rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
              <option value="unlisted">Unlisted (recommended for testing)</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
            <button disabled={creating} className="rounded-md bg-gold text-base font-medium px-4 py-2 text-sm disabled:opacity-50">
              {creating ? 'Creating…' : 'Create on YouTube'}
            </button>
          </form>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {ytBroadcast && (
            <div className="border-t border-gold/10 pt-4 space-y-2 text-sm">
              <p>Created: <span className="text-gold">{ytBroadcast.title}</span></p>
              <p className="text-xs text-cream/50">
                Start ingest from the Control Room once your source is ready, then use these controls to
                move the YouTube-side broadcast through its lifecycle.
              </p>
              <div className="flex gap-2">
                <button onClick={() => goLive('testing')} className="rounded-md border border-gold/40 px-3 py-1 text-xs">Mark Testing</button>
                <button onClick={() => goLive('live')} className="rounded-md border border-gold/40 px-3 py-1 text-xs">Go Live</button>
                <button onClick={() => goLive('complete')} className="rounded-md border border-red-500 text-red-400 px-3 py-1 text-xs">End Broadcast</button>
              </div>
              {liveStatus && <p className="text-xs text-cream/50">Lifecycle status: {liveStatus}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
