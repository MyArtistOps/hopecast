'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

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
const MEDIA_TYPES = ['audio', 'video', 'station_id', 'advertisement', 'announcement', 'artwork'];

const RIGHTS_COLOR: Record<string, string> = {
  owned: 'text-green-400', licensed: 'text-green-400', permission_granted: 'text-green-400',
  pending_review: 'text-yellow-400', do_not_broadcast: 'text-red-400',
};

const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function MediaLibraryClient({ stationId }: { stationId: string }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [rightsStatus, setRightsStatus] = useState('');

  // Upload panel state
  const [mode, setMode] = useState<'new' | 'replace'>('replace');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [mediaType, setMediaType] = useState('video');
  const [uploadCategory, setUploadCategory] = useState('');
  const [replaceTargetId, setReplaceTargetId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

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

  const handleUpload = async () => {
    if (!file) { setUploadError('Choose a file first.'); return; }
    if (mode === 'replace' && !replaceTargetId) { setUploadError('Choose which item this file replaces.'); return; }
    if (mode === 'new' && !title.trim()) { setUploadError('Title is required for a new item.'); return; }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      // 1. Get a signed upload URL from our server (server-side, service role)
      const urlRes = await fetch('/api/media/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not get upload URL');

      // 2. Upload the file directly from the browser to Supabase Storage —
      // never through our own server, so multi-GB video files don't hit any
      // function size/timeout limit.
      const { error: uploadErr } = await supabaseBrowser.storage
        .from('media')
        .uploadToSignedUrl(urlData.path, urlData.token, file);
      if (uploadErr) throw uploadErr;

      // 3. Save the small metadata record
      if (mode === 'replace') {
        const patchRes = await fetch('/api/media', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: replaceTargetId, storage_path: urlData.path }),
        });
        const patchData = await patchRes.json();
        if (!patchRes.ok) throw new Error(patchData.error || 'Could not update media record');
        setUploadSuccess('File replaced. Restart the stream on the server for it to take effect.');
      } else {
        const postRes = await fetch('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stationId, title, artist, mediaType, category: uploadCategory, storagePath: urlData.path,
          }),
        });
        const postData = await postRes.json();
        if (!postRes.ok) throw new Error(postData.error || 'Could not create media record');
        setUploadSuccess('New media item added.');
      }

      setFile(null);
      setTitle('');
      setArtist('');
      load();
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gold">Media Library</h1>

      <div className="bg-panel border border-gold/30 rounded-xl p-5 space-y-3">
        <h2 className="font-medium text-gold/90">Upload Media</h2>

        <div className="flex gap-4 text-sm">
          <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace an existing item's file</label>
          <label><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Add as a new item</label>
        </div>

        {mode === 'replace' ? (
          <select value={replaceTargetId} onChange={(e) => setReplaceTargetId(e.target.value)}
            className="w-full rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
            <option value="">Select the item this file replaces…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
              className="rounded-md bg-base border border-gold/20 px-3 py-2 text-sm" />
            <input placeholder="Artist (optional)" value={artist} onChange={(e) => setArtist(e.target.value)}
              className="rounded-md bg-base border border-gold/20 px-3 py-2 text-sm" />
            <select value={mediaType} onChange={(e) => setMediaType(e.target.value)}
              className="rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
              {MEDIA_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}
              className="rounded-md bg-base border border-gold/20 px-3 py-2 text-sm">
              <option value="">Category (optional)</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        )}

        <input type="file" accept="video/*,audio/*,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full text-sm text-cream/70" />

        {file && <p className="text-xs text-cream/50">{file.name} — {(file.size / (1024 * 1024)).toFixed(0)} MB</p>}
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
        {uploadSuccess && <p className="text-xs text-green-400">{uploadSuccess}</p>}

        <button onClick={handleUpload} disabled={uploading}
          className="rounded-md bg-gold text-base font-medium px-4 py-2 text-sm disabled:opacity-50">
          {uploading ? 'Uploading… this can take a while for large videos, please wait' : 'Upload'}
        </button>
      </div>

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
