-- HopeCast Platform - Core Schema
-- Generic broadcast-platform schema. No station-specific naming.

create extension if not exists "pgcrypto";

-- ---------- profiles (administrators) ----------
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('owner','admin','operator','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- stations ----------
create table if not exists stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  logo_url text,
  background_url text,
  primary_artist text,
  color_palette jsonb default '{}'::jsonb,
  timezone text not null default 'America/New_York',
  status text not null default 'offline' check (status in ('offline','preparing','starting','live','stopping','error')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- stream destinations ----------
-- Stream keys are NEVER stored in plaintext here. `encrypted_stream_key_reference`
-- points to a secret stored in the streaming server's environment/secret manager
-- (e.g. a key name in a vault), never the key itself.
create table if not exists stream_destinations (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  platform text not null default 'youtube',
  destination_name text not null,
  server_url text not null,
  encrypted_stream_key_reference text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- media assets ----------
create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  title text not null,
  artist text,
  album text,
  media_type text not null check (media_type in ('audio','video','station_id','advertisement','announcement','artwork')),
  category text,
  theme text,
  storage_path text not null,
  artwork_path text,
  duration_seconds numeric,
  file_size bigint,
  mime_type text,
  rights_status text not null default 'pending_review'
    check (rights_status in ('owned','licensed','permission_granted','pending_review','do_not_broadcast')),
  active boolean not null default true,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- playlists ----------
create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  name text not null,
  description text,
  loop_enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  total_duration_seconds numeric default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists(id) on delete cascade,
  media_asset_id uuid not null references media_assets(id) on delete restrict,
  position integer not null,
  item_type text not null default 'song',
  repeat_count integer not null default 1,
  transition_type text default 'none',
  settings jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_playlist_items_playlist on playlist_items(playlist_id, position);

-- ---------- schedules ----------
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  playlist_id uuid references playlists(id) on delete set null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  timezone text not null default 'America/New_York',
  recurrence_rule text,
  auto_start boolean not null default true,
  auto_stop boolean not null default true,
  auto_restart boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','cancelled','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- broadcasts (a single run of a schedule) ----------
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  playlist_id uuid references playlists(id),
  schedule_id uuid references schedules(id),
  title text,
  planned_start timestamptz,
  actual_start timestamptz,
  planned_end timestamptz,
  actual_end timestamptz,
  status text not null default 'pending'
    check (status in ('pending','preparing','live','stopping','completed','error')),
  restart_count integer not null default 0,
  current_item_id uuid references media_assets(id),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists broadcast_events (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  event_type text not null, -- start, stop, restart, crash, heartbeat, item_change, error, note
  message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_broadcast_events_broadcast on broadcast_events(broadcast_id, created_at);

-- ---------- rotation rules ----------
create table if not exists rotation_rules (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  rule_type text not null, -- station_id_every_n, promo_every_n, no_repeat_within_hours, featured_priority
  frequency integer,
  settings jsonb default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  station_id uuid references stations(id) on delete cascade,
  type text not null, -- email, dashboard
  recipient text,
  enabled boolean not null default true,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- audit log ----------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles(id),
  action text not null, -- stream_start, stream_stop, stream_restart, key_removed, etc.
  target_type text,
  target_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- updated_at trigger helper
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array['profiles','stations','stream_destinations','media_assets',
                                'playlists','playlist_items','schedules','broadcasts','rotation_rules','notifications'])
  loop
    execute format('drop trigger if exists trg_set_updated_at on %I; create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at();', t, t);
  end loop;
end $$;
