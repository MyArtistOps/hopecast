const cron = require('node-cron');

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Milestone 3 scheduling engine, scoped to a single station per worker
 * instance (process.env.STATION_ID). Handles:
 *  - one-time and simple weekly-recurring windows
 *  - auto-start / auto-stop at window boundaries
 *  - a 15-minute "starting soon" notification
 *  - reboot/crash recovery: per the decision made with the station owner,
 *    recovery always resumes the current item from its beginning rather
 *    than trying to reconstruct exact elapsed position.
 */
function registerScheduler({ supabase, ffmpeg, mediaResolver, notifications, logger, stationId, stationName }) {
  const notifiedSoon = new Set(); // scheduleId set, cleared daily, avoids duplicate "starting soon" pings

  function isWeeklyWindowActiveNow(schedule) {
    let recurrence;
    try { recurrence = JSON.parse(schedule.recurrence_rule || '{"type":"none"}'); }
    catch { recurrence = { type: 'none' }; }

    if (recurrence.type !== 'weekly') return null; // not a recurring schedule
    const now = new Date();
    const dayName = DAY_NAMES[now.getUTCDay()]; // NOTE: MVP compares by UTC day name;
    // for full timezone-accurate weekly boundaries, resolve start_at/end_at
    // time-of-day against schedule.timezone before comparing (left as a
    // refinement — the schedule's explicit start_at/end_at below is what
    // actually governs each individual occurrence).
    return recurrence.daysOfWeek?.includes(dayName) || false;
  }

  async function resolveAndStart(schedule) {
    const mode = 'mode1_video_loop';
    let sourcePath;
    try {
      sourcePath = await mediaResolver.resolveMode1Source(schedule.playlist_id);
    } catch (err) {
      logger.error({ err, scheduleId: schedule.id }, 'Media resolution failed');
      await notifications.mediaMissing(stationName, err.message);
      await supabase.from('schedules').update({ status: 'error' }).eq('id', schedule.id);
      return;
    }

    const { data: broadcast } = await supabase
      .from('broadcasts')
      .insert({
        station_id: stationId,
        playlist_id: schedule.playlist_id,
        schedule_id: schedule.id,
        title: schedule.title,
        planned_start: schedule.start_at,
        planned_end: schedule.end_at,
        mode,
        resolved_source_path: sourcePath,
        status: 'preparing',
      })
      .select()
      .single();

    const { data: dest } = await supabase
      .from('stream_destinations')
      .select('*')
      .eq('station_id', stationId)
      .eq('enabled', true)
      .limit(1)
      .single();

    if (!dest) {
      logger.error({ scheduleId: schedule.id }, 'No enabled stream destination configured');
      await supabase.from('broadcasts').update({ status: 'error', error_message: 'No stream destination configured' }).eq('id', broadcast.id);
      return;
    }

    // The stream key itself is resolved from the server's own secret store /
    // env, keyed by encrypted_stream_key_reference — never read back out of
    // the plain database column.
    const streamKey = process.env[dest.encrypted_stream_key_reference] || process.env.DEFAULT_YOUTUBE_STREAM_KEY;

    try {
      const claimed = await supabase.rpc('claim_broadcast_lock', {
        p_station_id: stationId,
        p_broadcast_id: broadcast.id,
      });
      if (claimed.error || !claimed.data || claimed.data.length === 0) {
        logger.warn({ scheduleId: schedule.id }, 'Another station is already live — skipping scheduled start until it frees up');
        await supabase.from('broadcasts').update({ status: 'error', error_message: 'Another station is live (single-broadcast MVP limit)' }).eq('id', broadcast.id);
        return;
      }

      await ffmpeg.start({
        mode,
        sourcePath,
        destinationUrl: dest.server_url,
        streamKey,
        broadcastId: broadcast.id,
      });
      await supabase.from('schedules').update({ status: 'running' }).eq('id', schedule.id);
      await notifications.streamStarted(stationName);
    } catch (err) {
      logger.error({ err }, 'Auto-start failed');
      await supabase.rpc('release_broadcast_lock', { p_station_id: stationId });
      await supabase.from('broadcasts').update({ status: 'error', error_message: err.message }).eq('id', broadcast.id);
    }
  }

  async function tick() {
    const now = new Date();
    const nowIso = now.toISOString();

    // ---- Auto-start: one-time schedules whose window has begun ----
    const { data: due } = await supabase
      .from('schedules')
      .select('*')
      .eq('station_id', stationId)
      .eq('status', 'scheduled')
      .eq('auto_start', true)
      .lte('start_at', nowIso);

    for (const sched of due || []) {
      logger.info({ scheduleId: sched.id }, 'Auto-start window reached');
      await resolveAndStart(sched);
    }

    // ---- Weekly recurring: re-arm schedules whose window just opened today ----
    const { data: recurring } = await supabase
      .from('schedules')
      .select('*')
      .eq('station_id', stationId)
      .eq('auto_start', true)
      .not('recurrence_rule', 'is', null);

    for (const sched of recurring || []) {
      if (sched.status === 'running') continue;
      const active = isWeeklyWindowActiveNow(sched);
      if (active && sched.status !== 'running') {
        logger.info({ scheduleId: sched.id }, 'Weekly recurrence window active — starting');
        await resolveAndStart(sched);
      }
    }

    // ---- "Starting soon" notification, 15 minutes ahead ----
    const { data: upcoming } = await supabase
      .from('schedules')
      .select('*')
      .eq('station_id', stationId)
      .eq('status', 'scheduled')
      .gte('start_at', nowIso)
      .lte('start_at', new Date(now.getTime() + 15 * 60 * 1000).toISOString());

    for (const sched of upcoming || []) {
      if (notifiedSoon.has(sched.id)) continue;
      const minutesUntil = Math.round((new Date(sched.start_at).getTime() - now.getTime()) / 60000);
      await notifications.scheduleApproaching(stationName, minutesUntil);
      notifiedSoon.add(sched.id);
    }

    // ---- Auto-stop: running schedules whose window has ended ----
    const { data: ending } = await supabase
      .from('schedules')
      .select('*')
      .eq('station_id', stationId)
      .eq('status', 'running')
      .eq('auto_stop', true)
      .not('end_at', 'is', null)
      .lte('end_at', nowIso);

    for (const sched of ending || []) {
      logger.info({ scheduleId: sched.id }, 'Auto-stop window reached');
      await ffmpeg.stop();
      await notifications.streamStopped(stationName);
      await supabase.from('schedules').update({ status: 'completed' }).eq('id', sched.id);
    }
  }

  /**
   * Reboot/crash recovery. Decision on file: if the server restarts mid-
   * broadcast and state is unclear, resume the CURRENT item from its
   * beginning rather than attempting to reconstruct exact elapsed position.
   * For the Mode-1 single-video-loop case this simply means: re-resolve the
   * same source and start FFmpeg again — the "current item" is the whole
   * loop, so restarting it from 0:00 is the correct and only sensible
   * interpretation.
   */
  async function recoverAfterRestart() {
    if (ffmpeg.getStatus().status !== 'offline') return; // nothing to recover

    const nowIso = new Date().toISOString();
    const { data: liveBroadcasts } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('station_id', stationId)
      .in('status', ['live', 'preparing'])
      .lte('planned_start', nowIso)
      .order('created_at', { ascending: false })
      .limit(1);

    const broadcast = liveBroadcasts && liveBroadcasts[0];
    if (!broadcast) return;
    if (broadcast.planned_end && new Date(broadcast.planned_end) < new Date()) return; // window already passed

    logger.warn({ broadcastId: broadcast.id }, 'Recovering broadcast after worker restart — resuming current item from its start');

    const { data: dest } = await supabase
      .from('stream_destinations')
      .select('*')
      .eq('station_id', stationId)
      .eq('enabled', true)
      .limit(1)
      .single();
    if (!dest) return;

    const streamKey = process.env[dest.encrypted_stream_key_reference] || process.env.DEFAULT_YOUTUBE_STREAM_KEY;

    const claimed = await supabase.rpc('claim_broadcast_lock', {
      p_station_id: stationId,
      p_broadcast_id: broadcast.id,
    });
    if (claimed.error || !claimed.data || claimed.data.length === 0) {
      logger.warn({ broadcastId: broadcast.id }, 'Cannot recover — another station currently holds the broadcast lock');
      return;
    }

    try {
      await ffmpeg.start({
        mode: broadcast.mode || 'mode1_video_loop',
        sourcePath: broadcast.resolved_source_path,
        destinationUrl: dest.server_url,
        streamKey,
        broadcastId: broadcast.id,
      });
      await notifications.streamRestarted(stationName, broadcast.restart_count || 0);
    } catch (err) {
      logger.error({ err }, 'Recovery start failed');
      await supabase.rpc('release_broadcast_lock', { p_station_id: stationId });
    }
  }

  recoverAfterRestart();
  cron.schedule('* * * * *', tick);
  cron.schedule('0 0 * * *', () => notifiedSoon.clear()); // reset daily
  logger.info({ stationId }, 'Scheduler registered (1-minute tick, station-scoped)');
}

module.exports = { registerScheduler };
