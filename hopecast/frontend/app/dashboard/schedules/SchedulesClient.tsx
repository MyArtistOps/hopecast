'use client';

import { useEffect, useState } from 'react';

type Schedule = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  recurrence_rule: string;
  status: string;
  auto_start: boolean;
  auto_stop: boolean;
};

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export default function SchedulesClient({ stationId, stationTimezone }: { stationId: string; stationTimezone: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [title, setTitle] = useState('Weekend Broadcast');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<'none' | 'weekly'>('weekly');
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>(['FRI', 'SAT', 'SUN']);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/schedules?stationId=${stationId}`);
    const data = await res.json();
    setSchedules(data.schedules || []);
  };

  useEffect(() => { load(); }, []);

  const toggleDay = (day: string) => {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId, title, startAt, endAt, timezone: stationTimezone,
          recurrenceType, daysOfWeek, autoStart: true, autoStop: true, autoRestart: true,
        }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-semibold text-gold">Schedules</h1>

      <form onSubmit={submit} className="bg-panel border border-gold/30 rounded-xl p-6 space-y-4">
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Broadcast title"
          className="w-full rounded-md bg-base border border-gold/20 px-3 py-2"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-cream/70">
            Start
            <input type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)}
              className="w-full mt-1 rounded-md bg-base border border-gold/20 px-3 py-2" />
          </label>
          <label className="text-sm text-cream/70">
            End (optional for weekly)
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)}
              className="w-full mt-1 rounded-md bg-base border border-gold/20 px-3 py-2" />
          </label>
        </div>

        <div className="flex gap-4 text-sm">
          <label><input type="radio" checked={recurrenceType === 'none'} onChange={() => setRecurrenceType('none')} /> One-time</label>
          <label><input type="radio" checked={recurrenceType === 'weekly'} onChange={() => setRecurrenceType('weekly')} /> Weekly</label>
        </div>

        {recurrenceType === 'weekly' && (
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => (
              <button type="button" key={day} onClick={() => toggleDay(day)}
                className={`px-3 py-1 rounded-full text-xs border ${daysOfWeek.includes(day) ? 'bg-gold text-base border-gold' : 'border-gold/30 text-cream/70'}`}>
                {day}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-cream/50">Times interpreted in {stationTimezone}. Auto-start, auto-stop, and auto-restart are enabled by default.</p>
        <button disabled={saving} className="rounded-md bg-gold text-base font-medium px-4 py-2 disabled:opacity-50">
          {saving ? 'Saving…' : 'Create Schedule'}
        </button>
      </form>

      <div className="space-y-2">
        {schedules.map((s) => (
          <div key={s.id} className="bg-panelAlt border border-gold/20 rounded-lg p-4 flex justify-between items-center">
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-cream/60">
                {new Date(s.start_at).toLocaleString()} {s.end_at ? `→ ${new Date(s.end_at).toLocaleString()}` : ''} ({s.timezone})
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-gold">{s.status}</span>
          </div>
        ))}
        {schedules.length === 0 && <p className="text-cream/50 text-sm">No schedules yet.</p>}
      </div>
    </div>
  );
}
