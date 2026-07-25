# Step-by-step deployment plan

## 1. Supabase project
- Create a new Supabase project.
- Run `supabase/migrations/0001_init.sql` then `0002_rls.sql` (SQL editor, in order).
- Create a Storage bucket (e.g. `media`) with private access; the worker
  generates signed URLs server-side — do not make it public.
- Create your first admin: sign up via Supabase Auth, then insert a matching
  row into `profiles` with `role = 'owner'`.

## 2. Streaming worker VPS
- Provision an Ubuntu 22.04/24.04 VPS (see resource estimate below).
- `git clone` this repo onto it, `cd streaming-worker`.
- `bash scripts/install-server.sh` (installs FFmpeg, Node 20, PM2, creates dirs).
- `cp .env.example .env`, fill in real Supabase service-role key, JWT secret,
  and (for initial testing) your YouTube RTMPS URL + stream key.
- `pm2 start ecosystem.config.js && pm2 save`
- `pm2 startup systemd` → run the command it prints → `pm2 save` again.
- Confirm: `curl http://localhost:4000/health`.
- Open port 4000 to the frontend's egress only (firewall rule / security group),
  not to the public internet if avoidable — put it behind a reverse proxy
  with TLS (e.g. Caddy or nginx) for HTTPS in production.

## 3. Frontend
- Deploy `frontend/` to Vercel or Netlify.
- Set environment variables in the host's dashboard (never in a committed file):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CONTROL_API_JWT_SECRET` (same value as the
  worker's), `STREAMING_WORKER_URL` (the VPS's HTTPS URL).

## 4. First broadcast (Milestone 2 proof-of-concept)
- Upload the ~30 min MP4 to Supabase Storage; note its path.
- Have the worker cache it into `LOCAL_MEDIA_CACHE_DIR` (Milestone 3 will
  automate this download step from the dashboard; for the first manual test,
  `scp` it directly onto the VPS into that directory).
- Create a YouTube Live event in YouTube Studio, set it unlisted, copy its
  RTMPS server URL + stream key.
- Insert a `stations`, `playlists`, and `broadcasts` row (or call the future
  "create test broadcast" endpoint once built).
- Hit Start from the dashboard control room.

## Estimated monthly cloud resources

| Component | Spec | Approx. monthly cost (USD, 2026 pricing ballpark) |
|---|---|---|
| VPS (streaming worker) | 2 vCPU / 4GB RAM, 720p/30fps, one station | $20–$40 |
| Supabase | Free or Pro tier depending on storage/DB usage | $0–$25 |
| Frontend hosting (Vercel/Netlify) | Hobby/starter tier | $0–$20 |
| Storage | Media library, tens of GB | Included in Supabase tier up to its cap |

Adding simultaneous multi-station streaming scales the VPS line roughly
linearly per additional concurrent 720p encode (~1 additional vCPU per station).
