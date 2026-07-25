# Features intentionally left as follow-ups

All six milestones from the spec are now built. What remains are
deliberately smaller, scoped-out items — not gaps in the milestone plan:

- Mode 3 (mixed video + audio + announcements normalized into one queue) —
  the rotation engine already produces a type-tagged ordered queue that Mode
  3 could consume; the remaining work is on the FFmpeg/concat side, not the
  scheduling or rotation logic
- Scheduler auto-start/auto-stop currently only resolves Mode 1 (single
  looping video); a Mode 2 (audio + rotation) schedule doesn't yet auto-start
  itself the same way — it's triggered manually via the dashboard/Settings
  page today
- Media **upload** UI (library search/filter/edit is built; uploading a new
  file from the browser isn't)
- Role-based permission tiers beyond "admin can do everything"
- 1080p output profile (720p is the MVP default per spec)
- Timezone-exact weekly-window boundaries (the current recurrence check
  compares day-of-week in UTC; a DST-aware, station-timezone-exact version is
  a small follow-up before relying on it across a DST change)
- Concurrent multi-station broadcasting (deliberately locked out via
  `broadcast_lock` per instruction — the schema and worker are already
  structured so lifting that single constraint is the whole upgrade)
- YouTube Analytics coverage is best-effort: some metrics may return
  "Requires YouTube API Connection" depending on channel eligibility and
  scope approval status, per the spec's own instruction not to promise
  complete analytics without one

## Explicitly excluded per your restrictions (not "postponed" — out of scope for this product)

Automatic label ownership tracking, label revenue-sharing, third-party access
grants, public Spotify-style streaming, public uploads from strangers,
subscriptions, royalty splitting, label dashboards, public artist accounts,
native mobile apps, outside-company advertising, multi-platform
simulcasting, and complex music-licensing logic. `rights_status` remains a
simple internal catalog flag, not a licensing system.

None of the above block the Milestone 2/3 proof-of-concept: upload one MP4,
schedule it (one-time or weekly), loop it, stream to YouTube, auto-recover
from a crash or reboot, and monitor/restart/stop from the dashboard.
