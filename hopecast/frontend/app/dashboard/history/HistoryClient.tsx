'use client';

import { useEffect, useState } from 'react';

type Broadcast = {
  id: string;
  title: string | null;
  status: string;
  planned_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  restart_count: number;
  error_message: string | null;
};

type Summary = {
  totalItemsPlayed: number;
  counts: { songs: number; station_ids: number; promos: number; other: number };
  restartEvents: number;
  errors: { message: string; at: string }[];
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-cream/60', error: 'text-red-400', live: 'text-green-400', pending: 'text-yellow-400',
};

function runtime(start: string | null, end: string | null) {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const minutes = Math.round((endMs - startMs) / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function HistoryClient({ stationId }: { stationId: string }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});

  useEffect(() => {
    fetch(`/api/broadcasts?stationId=${stationId}`).then((r) => r.json()).then((d) => setBroadcasts(d.broadcasts || []));
  }, [stationId]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!summaries[id]) {
      const res = await fetch(`/api/broadcasts/${id}/summary`);
      const data = await res.json();
      setSummaries((prev) => ({ ...prev, [id]: data }));
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-gold">Broadcast History</h1>

      <div className="space-y-2">
        {broadcasts.map((b) => (
          <div key={b.id} className="bg-panelAlt border border-gold/20 rounded-lg">
            <button onClick={() => toggleExpand(b.id)} className="w-full text-left p-3 flex justify-between items-center">
              <div>
                <p className="font-medium">{b.title || 'Untitled broadcast'}</p>
                <p className="text-xs text-cream/50">
                  {b.actual_start ? new Date(b.actual_start).toLocaleString() : 'Not started'} · runtime {runtime(b.actual_start, b.actual_end)}
                  {b.restart_count > 0 ? ` · ${b.restart_count} restart(s)` : ''}
                </p>
              </div>
              <span className={`text-xs uppercase tracking-wide ${STATUS_COLOR[b.status] || 'text-cream'}`}>{b.status}</span>
            </button>

            {expandedId === b.id && (
              <div className="border-t border-gold/10 p-3 text-sm space-y-1">
                {b.error_message && <p className="text-red-400 text-xs">{b.error_message}</p>}
                {summaries[b.id] ? (
                  <>
                    <p className="text-cream/70">
                      {summaries[b.id].totalItemsPlayed} items played — {summaries[b.id].counts.songs} songs,{' '}
                      {summaries[b.id].counts.station_ids} station IDs, {summaries[b.id].counts.promos} promos
                    </p>
                    {summaries[b.id].errors.length > 0 && (
                      <p className="text-red-400 text-xs">{summaries[b.id].errors.length} error event(s) logged</p>
                    )}
                  </>
                ) : <p className="text-cream/40 text-xs">Loading details…</p>}
              </div>
            )}
          </div>
        ))}
        {broadcasts.length === 0 && <p className="text-cream/50 text-sm">No broadcasts yet.</p>}
      </div>
    </div>
  );
}
