require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { createClient } = require('@supabase/supabase-js');

const { requireAuth } = require('./auth');
const { FfmpegController, STATUS } = require('./ffmpegController');
const { registerScheduler } = require('./scheduler');
const { MediaResolver } = require('./mediaResolver');
const { NotificationService } = require('./notifications');
const { buildOnAirQueue } = require('./rotationEngine');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// This worker process is bound to exactly one station. Multi-station support
// means running one PM2 app per station (see ecosystem.config.js) — not one
// process juggling several concurrent FFmpeg encodes, which would make crash
// recovery ambiguous about which station failed.
const STATION_ID = process.env.STATION_ID;
const STATION_NAME = process.env.STATION_NAME || 'HopeCast Station';
if (!STATION_ID) {
  logger.warn('STATION_ID is not set — scheduler auto-start/stop/recovery will not run for any station.');
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || '*' }));
app.use(pinoHttp({ logger, redact: ['req.headers.authorization'] }));

// Supabase service-role client: full DB access for the worker only.
// This key must never reach the browser or the frontend bundle.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const controlLimiter = rateLimit({ windowMs: 60_000, max: 30 });
app.use('/api/', controlLimiter);

const recentLogs = []; // ring buffer for the dashboard "logs and errors" page
const MAX_LOG_LINES = 500;
function pushLog(line) {
  recentLogs.push({ ts: new Date().toISOString(), line: line.trim() });
  if (recentLogs.length > MAX_LOG_LINES) recentLogs.shift();
}

let activeBroadcastId = null;
let nowPlayingQueue = []; // ordered [{mediaAssetId,title,artist}] for the currently loaded Mode 2 queue
let nowPlayingIndex = -1;
const notifications = new NotificationService({ config: process.env, logger });
const mediaResolver = new MediaResolver({
  supabase,
  cacheDir: process.env.LOCAL_MEDIA_CACHE_DIR || '/var/hopecast/media-cache',
  logger,
});

const ffmpeg = new FfmpegController({
  logger,
  config: process.env,
  onLog: pushLog,
  onQueueItemChange: async ({ itemId }) => {
    nowPlayingIndex = nowPlayingQueue.findIndex((i) => i.mediaAssetId === itemId);
    if (!activeBroadcastId) return;
    await supabase.from('broadcasts').update({ current_item_id: itemId }).eq('id', activeBroadcastId);
    await supabase.from('broadcast_events').insert({
      broadcast_id: activeBroadcastId,
      event_type: 'item_change',
      metadata: { mediaAssetId: itemId },
    });
  },
  onStatusChange: async ({ status, errorMessage, restartCount, note }) => {
    logger.info({ status, restartCount, note }, 'Stream status changed');

    if (status === STATUS.ERROR && errorMessage) {
      await notifications.streamCrashed(STATION_NAME, errorMessage);
    }

    if (!activeBroadcastId) return;
    const update = { status: mapWorkerStatusToBroadcastStatus(status) };
    if (errorMessage) update.error_message = errorMessage;
    if (typeof restartCount === 'number') update.restart_count = restartCount;
    if (status === STATUS.LIVE) {
      update.last_heartbeat_at = new Date().toISOString();
      if (restartCount > 0) await notifications.streamRestarted(STATION_NAME, restartCount);
    }
    if (status === STATUS.OFFLINE) {
      update.actual_end = new Date().toISOString();
      if (STATION_ID) await releaseStationLock(STATION_ID);
    }

    await supabase.from('broadcasts').update(update).eq('id', activeBroadcastId);
    await supabase.from('broadcast_events').insert({
      broadcast_id: activeBroadcastId,
      event_type: status,
      message: errorMessage || note || null,
    });
  },
});

function mapWorkerStatusToBroadcastStatus(workerStatus) {
  switch (workerStatus) {
    case STATUS.OFFLINE: return 'completed';
    case STATUS.ERROR: return 'error';
    case STATUS.LIVE:
    case STATUS.STARTING:
    case STATUS.STOPPING:
    case STATUS.PREPARING:
      return 'live';
    default: return 'pending';
  }
}

async function auditLog(action, req, metadata = {}) {
  await supabase.from('audit_log').insert({
    actor_profile_id: req.admin?.sub || null,
    action,
    metadata,
  });
}

// ---------- Health check (no auth required — used by load balancers) ----------
async function acquireStationLock(stationId, broadcastId) {
  const { data, error } = await supabase.rpc('claim_broadcast_lock', {
    p_station_id: stationId,
    p_broadcast_id: broadcastId,
  });
  if (error) throw new Error(`Lock check failed: ${error.message}`);
  if (!data || data.length === 0) {
    const { data: current } = await supabase.from('broadcast_lock').select('active_station_id').single();
    throw new Error(
      current?.active_station_id
        ? `Another station is already live (station ${current.active_station_id}). Only one station may broadcast at a time in this MVP.`
        : 'Could not acquire the broadcast lock.'
    );
  }
  return true;
}

async function releaseStationLock(stationId) {
  await supabase.rpc('release_broadcast_lock', { p_station_id: stationId });
}

app.get('/health', (req, res) => {
  res.json({ ok: true, status: ffmpeg.getStatus().status, time: new Date().toISOString() });
});

// ---------- Everything below requires a valid admin JWT ----------
const auth = requireAuth(process.env.CONTROL_API_JWT_SECRET);

app.get('/api/stream/status', auth, (req, res) => {
  res.json(ffmpeg.getStatus());
});

app.get('/api/stream/logs', auth, (req, res) => {
  res.json({ logs: recentLogs });
});

app.post('/api/stream/test-connection', auth, async (req, res) => {
  const { destinationUrl } = req.body || {};
  if (!destinationUrl || !/^rtmps?:\/\//.test(destinationUrl)) {
    return res.status(400).json({ ok: false, error: 'A valid rtmp(s):// destinationUrl is required' });
  }
  // A full RTMPS handshake test is environment-specific; for the MVP we
  // validate the URL shape and let the real connection test happen on start,
  // surfaced immediately via /api/stream/status.
  res.json({ ok: true, note: 'URL format valid. Full handshake is verified on stream start.' });
});

app.post('/api/stream/prepare', auth, async (req, res) => {
  const { broadcastId } = req.body || {};
  if (!broadcastId) return res.status(400).json({ error: 'broadcastId is required' });

  const { data: broadcast, error } = await supabase
    .from('broadcasts').select('*').eq('id', broadcastId).single();
  if (error || !broadcast) return res.status(404).json({ error: 'Broadcast not found' });

  await supabase.from('broadcasts').update({ status: 'preparing' }).eq('id', broadcastId);
  res.json({ ok: true, broadcast });
});

app.post('/api/stream/start', auth, async (req, res) => {
  try {
    const { broadcastId, mode, sourcePath, imagePath, audioListFilePath, destinationUrl, streamKey } = req.body || {};
    if (!broadcastId) return res.status(400).json({ error: 'broadcastId is required' });
    if (!STATION_ID) return res.status(400).json({ error: 'This worker has no STATION_ID configured' });

    await acquireStationLock(STATION_ID, broadcastId);

    activeBroadcastId = broadcastId;
    try {
      await ffmpeg.start({ mode, sourcePath, imagePath, audioListFilePath, destinationUrl, streamKey, broadcastId });
    } catch (startErr) {
      await releaseStationLock(STATION_ID); // don't hold the lock if FFmpeg itself failed to launch
      throw startErr;
    }
    await supabase.from('broadcasts').update({ status: 'preparing' }).eq('id', broadcastId);
    await auditLog('stream_start', req, { broadcastId });

    res.json({ ok: true, status: ffmpeg.getStatus() });
  } catch (err) {
    logger.error({ err }, 'start failed');
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/stream/start-audio-queue', auth, async (req, res) => {
  try {
    const { broadcastId, playlistId, destinationUrl, streamKey } = req.body || {};
    if (!broadcastId || !playlistId) {
      return res.status(400).json({ error: 'broadcastId and playlistId are required' });
    }
    if (!STATION_ID) return res.status(400).json({ error: 'This worker has no STATION_ID configured' });

    const { data: station } = await supabase.from('stations').select('*').eq('id', STATION_ID).single();
    const backgroundLocalPath = station ? await mediaResolver.resolveStationBackground(station) : null;

    const orderedQueue = await buildOnAirQueue({ supabase, stationId: STATION_ID, playlistId, logger });
    const queue = await mediaResolver.resolveOrderedQueue(orderedQueue, { stationBackgroundLocalPath: backgroundLocalPath });

    await acquireStationLock(STATION_ID, broadcastId);
    activeBroadcastId = broadcastId;
    nowPlayingQueue = queue.items.map((i) => ({ mediaAssetId: i.mediaAssetId, title: i.title, artist: i.artist }));
    nowPlayingIndex = 0;

    try {
      await ffmpeg.start({
        mode: 'mode2_static_audio',
        imagePath: queue.imagePath,
        audioListFilePath: queue.concatFilePath,
        queueItems: queue.items,
        destinationUrl, streamKey, broadcastId,
      });
    } catch (startErr) {
      await releaseStationLock(STATION_ID);
      throw startErr;
    }

    await supabase.from('broadcasts').update({
      status: 'preparing', mode: 'mode2_static_audio', playlist_id: playlistId,
    }).eq('id', broadcastId);
    await auditLog('stream_start', req, { broadcastId, mode: 'mode2_static_audio' });

    res.json({ ok: true, status: ffmpeg.getStatus(), totalDurationSeconds: queue.totalDurationSeconds });
  } catch (err) {
    logger.error({ err }, 'start-audio-queue failed');
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/stream/now-playing', auth, (req, res) => {
  if (nowPlayingQueue.length === 0) return res.json({ current: null, upNext: null });
  const current = nowPlayingIndex >= 0 ? nowPlayingQueue[nowPlayingIndex] : null;
  const upNext = nowPlayingIndex >= 0 ? nowPlayingQueue[(nowPlayingIndex + 1) % nowPlayingQueue.length] : null;
  res.json({ current, upNext });
});

app.post('/api/stream/stop', auth, async (req, res) => {
  await ffmpeg.stop();
  await notifications.streamStopped(STATION_NAME);
  await auditLog('stream_stop', req, { broadcastId: activeBroadcastId });
  nowPlayingQueue = [];
  nowPlayingIndex = -1;
  res.json({ ok: true, status: ffmpeg.getStatus() });
});

app.post('/api/stream/restart', auth, async (req, res) => {
  await ffmpeg.restart();
  await auditLog('stream_restart', req, { broadcastId: activeBroadcastId });
  res.json({ ok: true, status: ffmpeg.getStatus() });
});

app.post('/api/stream/emergency-stop', auth, async (req, res) => {
  await ffmpeg.emergencyStop();
  await auditLog('emergency_stop', req, { broadcastId: activeBroadcastId });
  activeBroadcastId = null;
  res.json({ ok: true, status: ffmpeg.getStatus() });
});

const port = Number(process.env.CONTROL_API_PORT || 4000);
app.listen(port, () => {
  logger.info(`HopeCast streaming worker control API listening on :${port}`);
  if (STATION_ID) {
    registerScheduler({
      supabase, ffmpeg, mediaResolver, notifications, logger,
      stationId: STATION_ID, stationName: STATION_NAME,
    });
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, stopping stream cleanly');
  await ffmpeg.stop();
  process.exit(0);
});
