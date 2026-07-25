-- Enforces "only one station live at a time" as a database-level invariant,
-- not just an operational convention. Each station runs its own worker
-- process (see ecosystem.config.js), so this lock is what actually prevents
-- two of those independent processes from both going live simultaneously.
--
-- Design note: this table is intentionally the ONLY piece of cross-station
-- shared state in the whole schema. Every other table (stations,
-- media_assets, playlists, schedules, broadcasts, stream_destinations) is
-- already fully partitioned by station_id, so removing this one row's
-- constraint later is the entire "turn on concurrent multi-station
-- broadcasting" migration — no redesign of anything else required.

create table if not exists broadcast_lock (
  id text primary key default 'global',
  active_station_id uuid references stations(id),
  active_broadcast_id uuid references broadcasts(id),
  acquired_at timestamptz,
  constraint single_lock_row check (id = 'global')
);

insert into broadcast_lock (id, active_station_id, active_broadcast_id, acquired_at)
values ('global', null, null, null)
on conflict (id) do nothing;

alter table broadcast_lock enable row level security;
drop policy if exists admin_all on broadcast_lock;
create policy admin_all on broadcast_lock for all using (is_admin()) with check (is_admin());

-- Atomic claim: succeeds (returns a row) only if no station currently holds
-- the lock. Called via a single UPDATE ... WHERE ... statement from the
-- worker, which Postgres serializes at the row level — safe even if two
-- station workers call this within the same millisecond.
create or replace function claim_broadcast_lock(p_station_id uuid, p_broadcast_id uuid)
returns setof broadcast_lock as $$
  update broadcast_lock
  set active_station_id = p_station_id,
      active_broadcast_id = p_broadcast_id,
      acquired_at = now()
  where id = 'global' and active_station_id is null
  returning *;
$$ language sql;

create or replace function release_broadcast_lock(p_station_id uuid)
returns setof broadcast_lock as $$
  update broadcast_lock
  set active_station_id = null,
      active_broadcast_id = null,
      acquired_at = null
  where id = 'global' and active_station_id = p_station_id
  returning *;
$$ language sql;
