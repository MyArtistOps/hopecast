-- Milestone 6: YouTube Data API integration. Purely additive — nothing here
-- changes how Milestones 1-5 work; a station can keep using the manual
-- RTMPS-paste flow indefinitely and never touch this table.

alter table stream_destinations
  add column if not exists youtube_channel_id text,
  add column if not exists youtube_channel_title text,
  -- Refresh/access tokens are encrypted at the application layer (AES-256-GCM,
  -- key held only in the frontend server's env — never the browser, never
  -- committed) before being written here. This is NOT a plain-text column;
  -- see frontend/lib/crypto.ts.
  add column if not exists oauth_refresh_token_encrypted text,
  add column if not exists oauth_access_token_encrypted text,
  add column if not exists oauth_token_expires_at timestamptz,
  add column if not exists oauth_connected_at timestamptz;

-- One row per YouTube-side live broadcast object created through the API,
-- separate from our own `broadcasts` table (which tracks the FFmpeg/worker
-- side of a broadcast run). A single internal broadcast maps to exactly one
-- youtube_broadcasts row when created via this module.
create table if not exists youtube_broadcasts (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  broadcast_id uuid references broadcasts(id) on delete set null,
  youtube_broadcast_id text not null,
  youtube_stream_id text not null,
  title text not null,
  description text,
  privacy_status text not null default 'unlisted' check (privacy_status in ('public','unlisted','private')),
  scheduled_start_time timestamptz,
  lifecycle_status text, -- created, ready, testing, live, complete, revoked
  -- The RTMPS ingestion URL/key YouTube issues for this specific stream
  -- object. Encrypted at rest for the same reason as the OAuth tokens above;
  -- decrypted server-side only, and only ever passed to the worker's
  -- /api/stream/start body — never re-read back out to the browser.
  ingestion_address text,
  stream_key_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table youtube_broadcasts enable row level security;
drop policy if exists admin_all on youtube_broadcasts;
create policy admin_all on youtube_broadcasts for all using (is_admin()) with check (is_admin());

drop trigger if exists trg_set_updated_at on youtube_broadcasts;
create trigger trg_set_updated_at before update on youtube_broadcasts
  for each row execute function set_updated_at();

-- A safe view for anything that might list broadcasts in the UI without
-- ever selecting the encrypted key column by accident.
create or replace view youtube_broadcasts_public as
  select id, station_id, broadcast_id, youtube_broadcast_id, youtube_stream_id,
         title, description, privacy_status, scheduled_start_time,
         lifecycle_status, created_at, updated_at
  from youtube_broadcasts;
