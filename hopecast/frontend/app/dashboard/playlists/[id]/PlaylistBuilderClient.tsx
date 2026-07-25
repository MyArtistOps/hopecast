'use client';

import { useEffect, useState, useCallback } from 'react';

type PlaylistItem = {
  id: string;
  media_asset_id: string;
  item_type: string;
  media_assets: { title: string; artist: string | null; duration_seconds: number | null; media_type: string; category: string | null };
};

type MediaOption = { id: string; title: string; artist: string | null; media_type: string };

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PlaylistBuilderClient({ playlistId, playlistName, stationId }: {
  playlistId: string; playlistName: string; stationId: string;
}) {
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [mediaOptions, setMediaOptions] = useState<MediaOption[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const loadItems = useCallback(async () => {
    const res = await fetch(`/api/playlists/${playlistId}/items`);
    const data = await res.json();
    setItems(data.items || []);
  }, [playlistId]);

  const loadMediaOptions = useCallback(async () => {
    const res = await fetch(`/api/media?stationId=${stationId}`);
    const data = await res.json();
    setMediaOptions(data.media || []);
  }, [stationId]);

  useEffect(() => { loadItems(); loadMediaOptions(); }, [loadItems, loadMediaOptions]);

  const totalDuration = items.reduce((sum, i) => sum + (i.media_assets?.duration_seconds || 0), 0);

  const addItem = async () => {
    if (!selectedMediaId) return;
    await fetch(`/api/playlists/${playlistId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaAssetId: selectedMediaId }),
    });
    setSelectedMediaId('');
    loadItems();
  };

  const removeItem = async (itemId: string) => {
    await fetch(`/api/playlists/${playlistId}/items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeItemId: itemId }),
    });
    loadItems();
  };

  const commitReorder = async (newOrder: PlaylistItem[]) => {
    setItems(newOrder);
    await fetch(`/api/playlists/${playlistId}/items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedItemIds: newOrder.map((i) => i.id) }),
    });
  };

  const onDrop = (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    setDragIndex(null);
    commitReorder(next);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gold">{playlistName}</h1>
        <p className="text-sm text-cream/60">{items.length} items · {formatDuration(totalDuration)} total</p>
      </div>

      <div className="flex gap-2">
        <select value={selectedMediaId} onChange={(e) => setSelectedMediaId(e.target.value)}
          className="flex-1 rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
          <option value="">Select media to add…</option>
          {mediaOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.title}{m.artist ? ` — ${m.artist}` : ''} ({m.media_type})</option>
          ))}
        </select>
        <button onClick={addItem} className="rounded-md bg-gold text-base font-medium px-4 py-2">Add</button>
      </div>

      <div className="space-y-1">
        {items.map((item, index) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(index)}
            className="flex items-center justify-between bg-panelAlt border border-gold/20 rounded-lg px-3 py-2 cursor-move"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-cream/30 text-sm select-none">⠿</span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.media_assets?.title}</p>
                <p className="text-xs text-cream/50 truncate">
                  {item.media_assets?.artist || item.item_type} · {Math.round((item.media_assets?.duration_seconds || 0) / 60)}m
                </p>
              </div>
            </div>
            <button onClick={() => removeItem(item.id)} className="text-xs text-red-400 hover:text-red-300 shrink-0">Remove</button>
          </div>
        ))}
        {items.length === 0 && <p className="text-cream/50 text-sm">No items yet — add some above.</p>}
      </div>

      <p className="text-xs text-cream/40">
        Drag items by the handle to reorder. Automatic station-ID and promo insertion (rotation rules)
        happens at broadcast time and isn't shown in this manual ordering.
      </p>
    </div>
  );
}
