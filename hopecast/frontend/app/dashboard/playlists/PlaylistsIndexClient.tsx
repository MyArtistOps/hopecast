'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Playlist = { id: string; name: string; status: string; total_duration_seconds: number | null };

export default function PlaylistsIndexClient({ stationId }: { stationId: string }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState('');

  const load = async () => {
    const res = await fetch(`/api/playlists?stationId=${stationId}`);
    const data = await res.json();
    setPlaylists(data.playlists || []);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, name }),
    });
    setName('');
    load();
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gold">Playlists</h1>

      <form onSubmit={create} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name"
          className="flex-1 rounded-md bg-base border border-gold/20 px-3 py-2" />
        <button className="rounded-md bg-gold text-base font-medium px-4 py-2">Create</button>
      </form>

      <div className="space-y-2">
        {playlists.map((p) => (
          <Link key={p.id} href={`/dashboard/playlists/${p.id}`}
            className="block bg-panelAlt border border-gold/20 rounded-lg p-3 hover:border-gold">
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-cream/50">{p.status} · {Math.round((p.total_duration_seconds || 0) / 60)} min</p>
          </Link>
        ))}
        {playlists.length === 0 && <p className="text-cream/50 text-sm">No playlists yet.</p>}
      </div>
    </div>
  );
}
