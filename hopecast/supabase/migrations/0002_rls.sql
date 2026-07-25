-- Enable RLS on every table and restrict to authenticated administrators.
-- The streaming worker uses the Supabase service-role key (bypasses RLS) —
-- never the anon/public key — for its background job access.

alter table profiles enable row level security;
alter table stations enable row level security;
alter table stream_destinations enable row level security;
alter table media_assets enable row level security;
alter table playlists enable row level security;
alter table playlist_items enable row level security;
alter table schedules enable row level security;
alter table broadcasts enable row level security;
alter table broadcast_events enable row level security;
alter table rotation_rules enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

-- Helper: is the current auth user a known, enabled administrator?
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles p
    where p.auth_user_id = auth.uid()
  );
$$ language sql stable security definer;

do $$
declare t text;
begin
  for t in select unnest(array['profiles','stations','stream_destinations','media_assets',
                                'playlists','playlist_items','schedules','broadcasts',
                                'broadcast_events','rotation_rules','notifications','audit_log'])
  loop
    execute format($f$
      drop policy if exists admin_all on %I;
      create policy admin_all on %I
        for all
        using (is_admin())
        with check (is_admin());
    $f$, t, t);
  end loop;
end $$;

-- stream_destinations: never select the key reference from the client role;
-- expose a view without it for the frontend, and reserve the full row for the
-- service role (streaming worker) only.
create or replace view stream_destinations_public as
  select id, station_id, platform, destination_name, enabled, created_at, updated_at
  from stream_destinations;
