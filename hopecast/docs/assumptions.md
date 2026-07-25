# Assumptions

1. One station broadcasts at a time per VPS/worker instance for the MVP.
   Multi-station *simultaneous* streaming means one worker process per
   station (documented in the deployment plan), not one worker juggling
   several FFmpeg processes at once — simpler and more crash-resistant.
2. You already have (or will create) a YouTube Live event and can paste its
   RTMPS server URL + stream key manually for the MVP; the YouTube Data API
   OAuth flow is Milestone 6, not required for first broadcast.
3. "Signed URLs" for Supabase Storage are resolved by the worker at broadcast-
   prepare time, not baked into the playlist at authoring time (so a signed
   URL never sits in the database as a long-lived secret).
4. The worker downloads/caches media to local disk (`LOCAL_MEDIA_CACHE_DIR`)
   before FFmpeg reads it, rather than streaming directly from a Supabase
   Storage URL — this avoids FFmpeg stalling the whole broadcast on a slow
   or expired signed URL mid-stream.
5. A single VPS (2 vCPU / 4GB RAM class) is assumed sufficient for 720p/30fps
   H.264 encoding of one station. Simultaneous multi-station broadcasting
   needs proportionally more CPU — see the resource estimate.
6. Row-level security assumes every administrator has a `profiles` row; the
   service-role key (used only by the worker) bypasses RLS by design, since
   the worker isn't an end-user session.
7. "Do Not Broadcast" enforcement happens at the point a media item is added
   to a playlist and again at broadcast-start validation — not just one or
   the other — so a status change after the fact still blocks a future start.
