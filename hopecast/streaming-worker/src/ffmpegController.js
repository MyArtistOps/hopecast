/**
 * ffmpegController.js
 *
 * Owns the single continuous FFmpeg child process for a broadcast.
 * Responsibilities:
 *  - Build a safe, parameterized FFmpeg command (never shell-interpolated from
 *    raw user input)
 *  - Spawn / monitor / restart the process
 *  - Enforce a restart-limit so a bad file can't loop-crash forever
 *  - Emit status + log lines for the dashboard to poll
 *
 * Mode 1 (MVP): loop a single existing MP4 compilation video to YouTube via
 * RTMPS. Mode 2 (image + audio) and Mode 3 (mixed queue) build on the same
 * spawn/monitor/restart core — only buildArgs() changes.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const STATUS = Object.freeze({
  OFFLINE: 'offline',
  PREPARING: 'preparing',
  STARTING: 'starting',
  LIVE: 'live',
  STOPPING: 'stopping',
  ERROR: 'error',
});

class FfmpegController {
  constructor({ logger, onStatusChange, onLog, onQueueItemChange, config }) {
    this.logger = logger;
    this.onStatusChange = onStatusChange || (() => {});
    this.onLog = onLog || (() => {});
    this.onQueueItemChange = onQueueItemChange || (() => {});
    this.config = config;

    this.proc = null;
    this.status = STATUS.OFFLINE;
    this.restartCount = 0;
    this.maxRestarts = Number(config.MAX_AUTO_RESTARTS || 5);
    this.restartBackoffMs = Number(config.RESTART_BACKOFF_SECONDS || 10) * 1000;
    this.stoppedIntentionally = false;
    this.currentBroadcast = null; // { broadcastId, mode, sourcePath, destination, endAt }
    this._restartTimer = null;
    this._queueCumulativeDurations = null; // [{itemId, endsAtSeconds}], Mode 2 only
    this._lastKnownItemId = null;
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this.onStatusChange({ status, ...extra });
  }

  /**
   * Mode 1: loop a single validated local video file to an RTMPS destination.
   * All inputs are validated file paths / numeric config, never raw strings
   * from the request body passed straight into a shell.
   */
  _buildArgsMode1({ sourcePath, destinationUrl, streamKey }) {
    const { STREAM_WIDTH, STREAM_HEIGHT, STREAM_FPS, STREAM_VIDEO_BITRATE,
            STREAM_AUDIO_BITRATE, STREAM_AUDIO_SAMPLE_RATE } = this.config;

    const rtmpsTarget = `${destinationUrl.replace(/\/$/, '')}/${streamKey}`;

    return [
      '-re',
      '-stream_loop', '-1',
      '-i', sourcePath,
      '-vf', `scale=${STREAM_WIDTH}:${STREAM_HEIGHT}:force_original_aspect_ratio=decrease,pad=${STREAM_WIDTH}:${STREAM_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-r', String(STREAM_FPS || 30),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', String(STREAM_VIDEO_BITRATE || '3000k'),
      '-maxrate', String(STREAM_VIDEO_BITRATE || '3000k'),
      '-bufsize', '6000k',
      '-pix_fmt', 'yuv420p',
      '-g', String((STREAM_FPS || 30) * 2), // keyframe every 2s, YouTube-friendly
      '-c:a', 'aac',
      '-b:a', String(STREAM_AUDIO_BITRATE || '160k'),
      '-ar', String(STREAM_AUDIO_SAMPLE_RATE || 44100),
      '-ac', '2',
      '-f', 'flv',
      rtmpsTarget,
    ];
  }

  /**
   * Mode 2: static artwork/background image + looping audio playlist concat.
   * `audioListFilePath` is a pre-validated ffconcat file the caller builds
   * from the ordered playlist (never raw user text).
   */
  _buildArgsMode2({ imagePath, audioListFilePath, destinationUrl, streamKey }) {
    const { STREAM_WIDTH, STREAM_HEIGHT, STREAM_FPS, STREAM_VIDEO_BITRATE,
            STREAM_AUDIO_BITRATE, STREAM_AUDIO_SAMPLE_RATE } = this.config;
    const rtmpsTarget = `${destinationUrl.replace(/\/$/, '')}/${streamKey}`;

    return [
      '-re',
      '-loop', '1',
      '-i', imagePath,
      '-f', 'concat', '-safe', '0', '-stream_loop', '-1',
      '-i', audioListFilePath,
      '-vf', `scale=${STREAM_WIDTH}:${STREAM_HEIGHT}:force_original_aspect_ratio=decrease,pad=${STREAM_WIDTH}:${STREAM_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-r', String(STREAM_FPS || 30),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'stillimage',
      '-b:v', String(STREAM_VIDEO_BITRATE || '2000k'),
      '-pix_fmt', 'yuv420p',
      '-g', String((STREAM_FPS || 30) * 2),
      '-c:a', 'aac',
      '-b:a', String(STREAM_AUDIO_BITRATE || '160k'),
      '-ar', String(STREAM_AUDIO_SAMPLE_RATE || 44100),
      '-ac', '2',
      '-shortest',
      '-f', 'flv',
      rtmpsTarget,
    ];
  }

  buildArgs(broadcast) {
    if (broadcast.mode === 'mode2_static_audio') return this._buildArgsMode2(broadcast);
    return this._buildArgsMode1(broadcast); // default / MVP mode
  }

  validateBroadcastInput(broadcast) {
    const errors = [];
    const checkFile = (p, label) => {
      if (!p) { errors.push(`${label} is required`); return; }
      const resolved = path.resolve(p);
      if (!resolved.startsWith(path.resolve(this.config.LOCAL_MEDIA_CACHE_DIR || '/var/hopecast/media-cache'))) {
        errors.push(`${label} must be inside the managed media cache directory`);
        return;
      }
      if (!fs.existsSync(resolved)) errors.push(`${label} not found on disk: ${resolved}`);
    };

    if (broadcast.mode === 'mode2_static_audio') {
      checkFile(broadcast.imagePath, 'Background image');
      checkFile(broadcast.audioListFilePath, 'Audio playlist file');
    } else {
      checkFile(broadcast.sourcePath, 'Source video');
    }
    if (!broadcast.destinationUrl || !/^rtmps?:\/\//.test(broadcast.destinationUrl)) {
      errors.push('destinationUrl must be a valid rtmp(s):// URL');
    }
    if (!broadcast.streamKey) errors.push('streamKey is required');

    return errors;
  }

  async start(broadcast) {
    if (this.proc) {
      throw new Error('A broadcast is already running. Stop it before starting a new one.');
    }
    const errors = this.validateBroadcastInput(broadcast);
    if (errors.length) {
      this._setStatus(STATUS.ERROR, { errorMessage: errors.join('; ') });
      throw new Error(`Validation failed: ${errors.join('; ')}`);
    }

    this.currentBroadcast = broadcast;
    this.stoppedIntentionally = false;
    this.restartCount = 0;

    if (broadcast.mode === 'mode2_static_audio' && Array.isArray(broadcast.queueItems)) {
      let cursor = 0;
      this._queueCumulativeDurations = broadcast.queueItems.map((item) => {
        cursor += item.durationSeconds || 0;
        return { itemId: item.mediaAssetId, endsAtSeconds: cursor };
      });
      this._queueLoopDurationSeconds = cursor;
    } else {
      this._queueCumulativeDurations = null;
    }
    this._lastKnownItemId = null;

    this._launch();
  }

  _launch() {
    this._setStatus(STATUS.STARTING);
    const args = this.buildArgs(this.currentBroadcast);

    // Never log the args verbatim — they contain the stream key in the RTMPS URL.
    this.logger.info('Launching FFmpeg (args redacted: contains stream key)');

    this.proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let sawKeyframe = false;

    this.proc.stdout.on('data', (chunk) => this.onLog(chunk.toString()));
    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      this.onLog(text);
      if (!sawKeyframe && /frame=\s*\d+/.test(text)) {
        sawKeyframe = true;
        this._setStatus(STATUS.LIVE);
      }
      if (this._queueCumulativeDurations) this._trackQueueProgress(text);
    });

    this.proc.on('exit', (code, signal) => this._handleExit(code, signal));
    this.proc.on('error', (err) => {
      this.logger.error({ err }, 'FFmpeg failed to spawn');
      this._setStatus(STATUS.ERROR, { errorMessage: err.message });
    });
  }

  _trackQueueProgress(ffmpegOutputChunk) {
    const match = ffmpegOutputChunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (!match) return;
    const [, hh, mm, ss] = match;
    const elapsedTotal = Number(hh) * 3600 + Number(mm) * 60 + parseFloat(ss);
    const loopDuration = this._queueLoopDurationSeconds || 1;
    const elapsedInLoop = loopDuration > 0 ? elapsedTotal % loopDuration : elapsedTotal;

    const current = this._queueCumulativeDurations.find((entry) => elapsedInLoop <= entry.endsAtSeconds);
    if (current && current.itemId !== this._lastKnownItemId) {
      this._lastKnownItemId = current.itemId;
      this.onQueueItemChange({ itemId: current.itemId });
    }
  }

  _handleExit(code, signal) {
    this.proc = null;
    if (this.stoppedIntentionally) {
      this._setStatus(STATUS.OFFLINE);
      this.currentBroadcast = null;
      return;
    }

    this.logger.warn({ code, signal }, 'FFmpeg exited unexpectedly');

    if (this.restartCount >= this.maxRestarts) {
      this._setStatus(STATUS.ERROR, {
        errorMessage: `FFmpeg crashed repeatedly (${this.restartCount} restarts). Auto-restart limit reached; manual intervention required.`,
      });
      return;
    }

    this.restartCount += 1;
    this._setStatus(STATUS.PREPARING, { restartCount: this.restartCount });
    this._restartTimer = setTimeout(() => this._launch(), this.restartBackoffMs);
  }

  async stop() {
    this.stoppedIntentionally = true;
    if (this._restartTimer) clearTimeout(this._restartTimer);
    this._setStatus(STATUS.STOPPING);
    if (this.proc) {
      this.proc.kill('SIGTERM');
      // Force-kill if it doesn't exit within 8s
      setTimeout(() => {
        if (this.proc) this.proc.kill('SIGKILL');
      }, 8000);
    } else {
      this._setStatus(STATUS.OFFLINE);
    }
  }

  async emergencyStop() {
    this.stoppedIntentionally = true;
    if (this._restartTimer) clearTimeout(this._restartTimer);
    if (this.proc) this.proc.kill('SIGKILL');
    this.proc = null;
    this.currentBroadcast = null;
    this._setStatus(STATUS.OFFLINE, { note: 'Emergency stop executed' });
  }

  async restart() {
    await this.stop();
    // give the OS a beat to release the RTMPS socket
    setTimeout(() => {
      if (this.currentBroadcast) {
        this.stoppedIntentionally = false;
        this.restartCount = 0;
        this._launch();
      }
    }, 2000);
  }

  getStatus() {
    return {
      status: this.status,
      restartCount: this.restartCount,
      broadcast: this.currentBroadcast
        ? { ...this.currentBroadcast, streamKey: undefined, destinationUrl: '[redacted]' }
        : null,
    };
  }
}

module.exports = { FfmpegController, STATUS };
