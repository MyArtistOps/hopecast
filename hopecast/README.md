# HopeCast Platform (prototype)

A private broadcast-management platform, with ownership kept deliberately
separate at every layer:

- **Hope Creative LLC** (or your technology company) owns the **HopeCast
  Radio Platform** — the generic, station-agnostic codebase in this repo.
- The platform **powers** individual stations. **Delana Hope Weekend Radio**
  is the first one, configured as a `stations` row — not hardcoded into the
  platform's name, schema, or source.
- Each station **broadcasts through** its own stream destination — for this
  station, the Delana Hope YouTube channel — configured per-station in
  `stream_destinations`, so a future station can point at a different
  channel without touching platform code.

No label ownership, label revenue-sharing, or third-party access logic is
built in anywhere — those are business/legal decisions kept out of the
software, per instruction.

## Multi-station design, single-station operation

Every table is already partitioned by `station_id` — stations, media, playlists,
schedules, broadcasts, and stream destinations are each independent per station
from the first migration. The **only** cross-station shared state in the whole
schema is a one-row `broadcast_lock` table (`0004_broadcast_lock.sql`), which
the worker atomically claims before any broadcast starts (manual, scheduled, or
recovered after a crash/reboot) and releases when it ends. That single lock —
not a scattered convention — is what actually prevents two stations from
going live at once in this MVP. Turning on concurrent multi-station
broadcasting later means relaxing that one constraint; nothing else in the
schema or worker needs to change.

## What's included in this prototype (Milestones 1–6, complete)

- `supabase/migrations/` — full Postgres schema (stations, media, playlists,
  schedules, broadcasts, rotation rules, notifications, audit log) + row-level
  security restricted to authenticated admins.
- `streaming-worker/` — the persistent Node.js service that owns the single
  continuous FFmpeg process: start/stop/restart/emergency-stop, auto-restart
  with a hard limit, structured logs, a minute-by-minute scheduler stub, and
  a JWT-protected control API. **This is the piece that must run on a real
  VPS**, not Vercel/Netlify/Supabase Edge Functions.
- `frontend/` — Next.js + Tailwind admin dashboard scaffold: Supabase-authenticated
  login, a protected control-room page with Start/Stop/Restart/Emergency Stop,
  a Schedules page (one-time or weekly-recurring windows, auto-start/stop),
  and a server-side API route that mints the worker JWT so the stream key and
  worker URL never reach the browser.
- **Milestone 3 additions:** `mediaResolver.js` (downloads/caches Supabase
  Storage media locally and enforces "Do Not Broadcast" right before airing),
  `notifications.js` (email via SMTP, extensible to SMS/push later), and a
  rewritten `scheduler.js` that actually auto-starts/stops broadcasts from the
  `schedules` table, supports simple weekly recurrence, sends a "starting
  soon" notice 15 minutes out, and recovers from a server reboot or worker
  crash by **resuming the current item from its beginning** (the explicit
  decision on file, rather than guessing elapsed position).
- The worker is now **station-scoped** (`STATION_ID` env var) so a second
  station later runs as its own PM2 app/process — see the template in
  `ecosystem.config.js` — never as one process juggling multiple concurrent
  FFmpeg encodes.
- `docs/` — architecture diagram, assumptions, postponed features, deployment
  plan, and resource estimate.

- **Milestone 5 additions:** `rotationEngine.js` automatically inserts station
  IDs and promos into the on-air queue (every N songs, per active
  `rotation_rules`), shuffles within chosen categories while respecting a
  no-repeat-within-hours window, prioritizes featured songs, keeps fixed
  opening/closing items in place, and is a safe no-op when no rules are
  active (so it doesn't disturb the Milestone 4 path). It's now the standard
  path for `POST /api/stream/start-audio-queue`.
  On the frontend: a drag-and-drop **Playlist Builder** (native HTML5 drag
  events — add/remove/reorder items, live duration total), a **Media
  Library** page (search by title/artist/album, filter by category/rights
  status, quick-edit active/rights-status), and a **Broadcast History** page
  (runtime, restart count, and — per broadcast — counts of songs / station
  IDs / promos actually played, computed from `broadcast_events`).

- **Milestone 6 additions (YouTube Data API module — optional, doesn't touch
  the Milestone 1–5 RTMPS path):** a Settings page to connect a station's
  YouTube channel via Google OAuth; creating a scheduled broadcast (title,
  description, privacy status) plus a fresh bound RTMPS stream through the
  API instead of pasting one manually; a thumbnail upload endpoint; explicit
  lifecycle control (testing → live → complete) separate from starting the
  actual FFmpeg ingest; a live-status endpoint; and a best-effort analytics
  endpoint that clearly returns `"Requires YouTube API Connection"` for
  anything unavailable rather than guessing. OAuth refresh/access tokens and
  the dynamically-issued RTMPS key are AES-256-GCM encrypted at rest
  (`lib/crypto.ts`) with a server-only key — never a plain-text DB column,
  never sent to the browser.

## What's a stub / next step (small loose ends only — all six milestones are otherwise complete)

- Mode 3 (mixed video + audio + announcements in one queue) — Mode 1 and
  Mode 2 are both built; the rotation engine's type-tagged output already
  fits Mode 3, the remaining work is on the FFmpeg/concat side
- Scheduler auto-start currently only resolves Mode 1 (single looping video)
  automatically; a Mode 2 (audio + rotation) schedule is started manually
  from the dashboard today rather than by the cron scheduler
- Media **upload** UI (the library page lists/searches/edits existing rows;
  uploading a brand-new file from the browser isn't built)
- Role-based permission tiers beyond "admin can do everything"
- 1080p output profile (720p is the MVP default per spec)

See `docs/postponed-features.md` for the complete, explicit list.

## Local development

**Worker:**
```bash
cd streaming-worker
cp .env.example .env   # fill in real values, never commit .env
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

You'll need `ffmpeg` installed locally to test the worker
(`apt install ffmpeg` / `brew install ffmpeg`).

## Cloud deployment (summary — see docs/deployment-plan.md for full steps)

1. Provision a small Ubuntu VPS (see resource estimate in docs/).
2. Run `streaming-worker/scripts/install-server.sh` on it.
3. Set real `.env` values on the server only; never commit them.
4. `pm2 start ecosystem.config.js && pm2 save && pm2 startup systemd`.
5. Deploy `frontend/` to Vercel or Netlify; set its env vars in the host's
   dashboard (not in a committed file) pointing at the VPS's worker URL.
6. Run the Supabase migrations against your project (`supabase db push` or
   paste the SQL files into the SQL editor in order).

## Connecting YouTube (Milestone 6, optional)

1. In Google Cloud Console, create/select a project, enable **YouTube Data
   API v3** and **YouTube Analytics API**.
2. Under "OAuth consent screen," add the scopes this module requests
   (`youtube`, `youtube.force-ssl`, `yt-analytics.readonly`) and add your own
   Google account as a test user while the app is unverified.
3. Under "Credentials," create an **OAuth 2.0 Client ID** (Web application),
   and add `https://your-dashboard-domain.com/api/youtube/callback` as an
   authorized redirect URI.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and
   a generated `YOUTUBE_OAUTH_ENCRYPTION_KEY` (`openssl rand -hex 32`) in the
   frontend's environment.
5. From Settings in the dashboard, click "Connect YouTube Channel."

None of this is required to use Milestones 1–5 — the manual RTMPS-paste flow
keeps working whether or not a station ever connects YouTube this way.

## Testing checklist (Milestone 2 proof-of-concept)

- [ ] Admin can log in and reach `/dashboard`
- [ ] `GET /health` on the worker returns `ok: true`
- [ ] Uploading a ~30 min MP4 and starting a broadcast produces `status: live`
      in under ~15 seconds
- [ ] Dashboard shows elapsed time / restart count
- [ ] Killing the ffmpeg process manually (`pkill ffmpeg`) triggers an
      automatic restart within `RESTART_BACKOFF_SECONDS`
- [ ] Stop button cleanly ends the RTMPS session
- [ ] Emergency Stop works even if `stop` hangs
- [ ] Audit log rows appear for start/stop/restart

## Troubleshooting

- **Stream shows "preparing" forever** — check `streaming-worker` logs; most
  often FFmpeg couldn't find the source file (path outside `LOCAL_MEDIA_CACHE_DIR`
  is rejected by design) or the RTMPS URL/key is wrong.
- **YouTube shows "no signal"** — verify `server_url` + `stream_key` match what
  YouTube Studio issued *for that specific event*, and that the event is set
  to accept an incoming stream.
- **Repeated restarts then `error` status** — the `MAX_AUTO_RESTARTS` guard
  tripped; check `/api/stream/logs` for the root cause before restarting
  manually.

## Security notes

- Stream keys never live in frontend code, browser responses, or Git history.
  They're referenced from `stream_destinations.encrypted_stream_key_reference`
  and resolved server-side on the worker only.
- The dashboard never talks to the worker directly from the browser — every
  control action goes through a Next.js server route that mints a 2-minute JWT.
- All FFmpeg arguments are built from validated, whitelisted config — never
  raw string interpolation of user input into a shell command.
