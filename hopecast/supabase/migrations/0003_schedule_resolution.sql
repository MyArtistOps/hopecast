-- Milestone 3: fields needed to resolve a schedule into a concrete FFmpeg
-- source and to support reboot/crash recovery.

alter table broadcasts
  add column if not exists mode text not null default 'mode1_video_loop',
  add column if not exists resolved_source_path text,
  add column if not exists last_heartbeat_at timestamptz;

-- Recurrence is stored as simple JSON, not a full RRULE, per the spec's
-- "does not need to be a sophisticated engine yet":
--   { "type": "none" } | { "type": "weekly", "daysOfWeek": ["FRI","SAT","SUN"] }
-- start_at/end_at continue to carry the specific clock times, interpreted in
-- the schedule's timezone column.
comment on column schedules.recurrence_rule is
  'JSON string: {"type":"none"} or {"type":"weekly","daysOfWeek":["FRI","SAT","SUN"]}';

-- One VPS/worker process is bound to a single station via the STATION_ID
-- env var. This index supports that worker efficiently filtering its queries.
create index if not exists idx_schedules_station_status on schedules(station_id, status);
create index if not exists idx_broadcasts_station_status on broadcasts(station_id, status);
