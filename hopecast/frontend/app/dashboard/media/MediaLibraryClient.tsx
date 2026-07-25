'use client';

import { useEffect, useState, useCallback } from 'react';

type MediaAsset = {
  id: string;
  title: string;
  artist: string | null;
  media_type: string;
  category: string | null;
  duration_seconds: number | null;
  rights_status: string;
  active: boolean;
};

const CATEGORIES = ['worship', 'breakthrough', 'healing', 'prayer', 'faith', 'encouragement',
  'warfare', 'testimony', 'gospel_r_and_b', 'seasonal', 'station_id', 'advertisement', 'scripture', 'announcement'];
const RIGHTS = ['owned', 'licensed', 'permission_granted', 'pending_review', 'do_not_broadcast'];

const RIGHTS_COLOR: Record<string, string> = {
  owned: 'text-green-400', licensed: 'text-green-400', permission_granted: 'text-green-400',
  pending_review: 'text-yellow-400', do_not_broadcast: 'text-red-400',
};

export default function MediaLibraryClient({ stationId }: { stationId: string }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [rightsStatus, setRightsStatus] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ stationId });
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (rightsStatus) params.set('rightsStatus', rightsStatus);
    const res = await fetch(`/api/media?${params}`);
    const data = await res.json();
    setItems(data.media || []);
  }, [stationId, q, category, rightsStatus]);

  useEffect(() => { load(); }, [load]);

  const updateField = async (id: string, field: string, value: unknown) => {
    await fetch('/api/media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    });
    load();
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-gold">Media Library</h1>

      <div className="flex flex-wrap gap-2">
        <input placeholder="Search title/artist/album" value={q} onChange={(e) => setQ(e.target.value)}
          className="flex-1 min-w-[160px] rounded-md bg-base border border-gold/20 px-3 py-2 text-sm" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={rightsStatus} onChange={(e) => setRightsStatus(e.target.value)}
          className="rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
          <option value="">All rights statuses</option>
          {RIGHTS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-panelAlt border border-gold/20 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{item.title}</p>
              <p className="text-xs text-cream/50 truncate">
                {item.artist || '—'} · {item.media_type} · {item.category || 'uncategorized'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={item.rights_status}
                onChange={(e) => updateField(item.id, 'rights_status', e.target.value)}
                className={`text-xs bg-base border border-gold/20 rounded px-2 py-1 ${RIGHTS_COLOR[item.rights_status]}`}
              >
                {RIGHTS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" checked={item.active} onChange={(e) => updateField(item.id, 'active', e.target.checked)} />
                Active
              </label>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-cream/50 text-sm">No media found.</p>}
      </div>
    </div>
  );
}
