'use client';

import { useEffect, useState, useCallback } from 'react';

type StreamStatus = {
  status: 'offline' | 'preparing' | 'starting' | 'live' | 'stopping' | 'error';
  restartCount: number;
  broadcast: { broadcastId?: string; mode?: string } | null;
};

type NowPlaying = {
  current: { title: string; artist?: string } | null;
  upNext: { title: string; artist?: string } | null;
};

type Playlist = { id: string; name: string };

const STATUS_COLOR: Record<string, string> = {
  offline: 'bg-gray-500', preparing: 'bg-yellow-500', starting: 'bg-yellow-400',
  live: 'bg-green-500', stopping: 'bg-orange-500', error: 'bg-red-600',
};

async function callAction(action: string, body?: object) {
  const res = await fetch(`/api/stream/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export default function ControlRoom({ stationName, stationId }: { stationName: string; stationId: string }) {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [statusData, nowPlayingData] = await Promise.all([callAction('status'), callAction('now-playing')]);
    setStatus(statusData);
    setNowPlaying(nowPlayingData);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    fetch(`/api/playlists?stationId=${stationId}`)
      .then((r) => r.json())
      .then((d) => {
        setPlaylists(d.playlists || []);
        if (d.playlists?.[0]) setSelectedPlaylistId(d.playlists[0].id);
      });
  }, [stationId]);

  const run = async (action: string, body?: object) => {
    setBusy(true);
    setStartError(null);
    try {
      const result = await run_inner(action, body);
      if (result?.error) setStartError(result.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const run_inner = async (action: string, body?: object) => callAction(action, body);

  const startBroadcast = () => {
    if (!selectedPlaylistId) { setStartError('Choose a playlist first.'); return; }
    run('start-from-playlist', { playlistId: selectedPlaylistId });
  };

  const s = status?.status || 'offline';

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gold">{stationName}</h1>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${STATUS_COLOR[s]}`} />
          <span className="uppercase text-sm tracking-wide">{s}</span>
        </div>
      </header>

      {status?.restartCount ? (
        <p className="text-sm text-yellow-400">Auto-restarted {status.restartCount} time(s) this broadcast.</p>
      ) : null}

      {nowPlaying?.current && (
        <div className="bg-panel border border-gold/30 rounded-xl p-4 space-y-1">
          <p className="text-xs uppercase tracking-wide text-gold/70">Now Playing</p>
          <p className="text-lg font-medium">{nowPlaying.current.title}</p>
          {nowPlaying.current.artist && <p className="text-sm text-cream/60">{nowPlaying.current.artist}</p>}
          {nowPlaying.upNext && (
            <p className="text-xs text-cream/50 pt-2">
              Up next: {nowPlaying.upNext.title}{nowPlaying.upNext.artist ? ` — ${nowPlaying.upNext.artist}` : ''}
            </p>
          )}
        </div>
      )}

      {s === 'offline' && (
        <div className="bg-panel border border-gold/30 rounded-xl p-4 space-y-3">
          <p className="text-xs uppercase tracking-wide text-gold/70">Start a broadcast</p>
          <select value={selectedPlaylistId} onChange={(e) => setSelectedPlaylistId(e.target.value)}
            className="w-full rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
            {playlists.length === 0 && <option value="">No playlists yet — create one first</option>}
            {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p className="text-xs text-cream/40">
            A playlist with a single video loops that video. A playlist with songs streams them over your station's background image.
          </p>
        </div>
      )}

      {startError && <p className="text-sm text-red-400">{startError}</p>}

      <div className="grid grid-cols-2 gap-3">
        <button
          disabled={busy || s === 'live' || s === 'starting' || !selectedPlaylistId}
          onClick={startBroadcast}
          className="rounded-lg bg-panelAlt border border-gold/40 py-3 font-medium hover:border-gold disabled:opacity-40"
        >
          Start Stream
        </button>
        <button
          disabled={busy || s === 'offline'}
          onClick={() => run('stop')}
          className="rounded-lg bg-panelAlt border border-gold/40 py-3 font-medium hover:border-gold disabled:opacity-40"
        >
          Stop Stream
        </button>
        <button
          disabled={busy || s === 'offline'}
          onClick={() => run('restart')}
          className="rounded-lg bg-panelAlt border border-gold/40 py-3 font-medium hover:border-gold disabled:opacity-40"
        >
          Restart Stream
        </button>
        <button
          disabled={busy}
          onClick={() => (confirmEmergency ? run('emergency-stop') : setConfirmEmergency(true))}
          className="rounded-lg bg-red-900/60 border border-red-500 py-3 font-medium hover:bg-red-900"
        >
          {confirmEmergency ? 'Confirm Emergency Stop' : 'Emergency Stop'}
        </button>
      </div>

      <p className="text-xs text-cream/50">
        Mobile-friendly controls — designed to be usable from a phone if a broadcast needs to be stopped remotely.
      </p>
    </div>
  );
}
