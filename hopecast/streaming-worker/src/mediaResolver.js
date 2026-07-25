const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Resolves a playlist's Mode-1 source (a single video item) to a local file
 * path FFmpeg can read, downloading it from Supabase Storage via a signed
 * URL if it isn't already cached. Also enforces the "Do Not Broadcast" rule
 * at the last possible moment before a stream goes live, not just at
 * playlist-authoring time.
 */
class MediaResolver {
  constructor({ supabase, cacheDir, logger }) {
    this.supabase = supabase;
    this.cacheDir = cacheDir;
    this.logger = logger;
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  }

  async _download(signedUrl, destPath) {
    return new Promise((resolve, reject) => {
      const tmpPath = `${destPath}.part`;
      const file = fs.createWriteStream(tmpPath);
      https.get(signedUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tmpPath, destPath);
            resolve(destPath);
          });
        });
      }).on('error', (err) => {
        fs.unlink(tmpPath, () => {});
        reject(err);
      });
    });
  }

  async _resolveAssetLocal(asset) {
    if (!asset) throw new Error('Missing media asset');
    if (!asset.active) throw new Error(`Media asset ${asset.id} is inactive`);
    if (asset.rights_status === 'do_not_broadcast') {
      throw new Error(`Media asset ${asset.id} is marked Do Not Broadcast and cannot air`);
    }

    const ext = path.extname(asset.storage_path) || '.bin';
    const localPath = path.join(this.cacheDir, `${asset.id}${ext}`);
    if (fs.existsSync(localPath)) return localPath;

    const { data: signed, error: signErr } = await this.supabase.storage
      .from('media')
      .createSignedUrl(asset.storage_path, 60 * 30);
    if (signErr || !signed) throw new Error(`Could not sign URL for ${asset.storage_path}`);

    this.logger.info({ assetId: asset.id }, 'Downloading media to local cache');
    await this._download(signed.signedUrl, localPath);
    return localPath;
  }

  /**
   * Resolve a playlist assumed to contain exactly one Mode-1 video item
   * (the Milestone 2/3 case). Returns the local path FFmpeg should read.
   * Throws if the media is missing, marked "do_not_broadcast", or the
   * signed URL / download fails — callers must surface this as a
   * "media_missing" / "error" notification rather than silently continuing.
   */
  async resolveMode1Source(playlistId) {
    const { data: items, error: itemsErr } = await this.supabase
      .from('playlist_items')
      .select('*, media_assets(*)')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true })
      .limit(1);

    if (itemsErr || !items || items.length === 0) {
      throw new Error(`Playlist ${playlistId} has no items to resolve`);
    }

    const asset = items[0].media_assets;
    return this._resolveAssetLocal(asset);
  }
  /**
   * Resolve an ordered audio playlist (Mode 2 — Milestone 4): downloads/
   * caches every item, skips inactive or "do_not_broadcast" items (logging
   * a warning rather than failing the whole broadcast for one bad item),
   * and returns everything the FFmpeg queue player and dashboard need:
   * an ffconcat file for FFmpeg, a background image, and the ordered item
   * list (with durations) for now-playing tracking.
   */
  async resolveAudioQueue(playlistId, { stationBackgroundLocalPath } = {}) {
    const { data: items, error } = await this.supabase
      .from('playlist_items')
      .select('*, media_assets(*)')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true });

    if (error || !items || items.length === 0) {
      throw new Error(`Playlist ${playlistId} has no items to resolve`);
    }

    const resolved = [];
    for (const item of items) {
      const asset = item.media_assets;
      if (!asset) continue;
      if (!asset.active || asset.rights_status === 'do_not_broadcast') {
        this.logger.warn({ assetId: asset.id }, 'Skipping inactive/do-not-broadcast item in audio queue');
        continue;
      }
      try {
        const localPath = await this._resolveAssetLocal(asset);
        resolved.push({
          mediaAssetId: asset.id,
          title: asset.title,
          artist: asset.artist,
          itemType: item.item_type,
          localPath,
          durationSeconds: Number(asset.duration_seconds || 0),
        });
      } catch (err) {
        this.logger.warn({ assetId: asset.id, err: err.message }, 'Skipping item that failed to resolve');
      }
    }

    if (resolved.length === 0) throw new Error('No playable items remain in this playlist after filtering');

    const concatPath = path.join(this.cacheDir, `queue-${playlistId}.ffconcat`);
    const concatBody = resolved
      .map((r) => `file '${r.localPath.replace(/'/g, "'\\''")}'`) // ffconcat-safe single-quote escaping
      .join('\n');
    fs.writeFileSync(concatPath, concatBody, 'utf8');

    return {
      concatFilePath: concatPath,
      imagePath: stationBackgroundLocalPath || null,
      items: resolved,
      totalDurationSeconds: resolved.reduce((sum, r) => sum + r.durationSeconds, 0),
    };
  }

  /**
   * Like resolveAudioQueue, but takes an already-ordered list of asset stubs
   * (as produced by rotationEngine.buildOnAirQueue) instead of reading a
   * playlist directly — used once rotation rules are involved, since the
   * final on-air order may differ from the playlist's stored order and may
   * repeat assets (e.g. the same station ID played several times).
   */
  async resolveOrderedQueue(orderedAssets, { stationBackgroundLocalPath } = {}) {
    if (!orderedAssets || orderedAssets.length === 0) {
      throw new Error('Resolved on-air queue is empty');
    }

    const resolved = [];
    for (const stub of orderedAssets) {
      try {
        const localPath = await this._resolveAssetLocal({
          id: stub.mediaAssetId,
          storage_path: stub.storage_path,
          active: true,
          rights_status: 'owned', // already filtered upstream by the rotation engine
        });
        resolved.push({ ...stub, localPath });
      } catch (err) {
        this.logger.warn({ assetId: stub.mediaAssetId, err: err.message }, 'Skipping item that failed to resolve');
      }
    }

    if (resolved.length === 0) throw new Error('No playable items remain after resolving the on-air queue');

    const concatPath = path.join(this.cacheDir, `onair-queue-${Date.now()}.ffconcat`);
    const concatBody = resolved
      .map((r) => `file '${r.localPath.replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(concatPath, concatBody, 'utf8');

    return {
      concatFilePath: concatPath,
      imagePath: stationBackgroundLocalPath || null,
      items: resolved,
      totalDurationSeconds: resolved.reduce((sum, r) => sum + (r.durationSeconds || 0), 0),
    };
  }

  async resolveStationBackground(station) {
    if (!station?.background_url) return null;
    // background_url is a storage_path, not a public URL, per the "no public
    // storage URLs" requirement — resolved the same way as any other asset.
    return this._resolveAssetLocal({
      id: `station-bg-${station.id}`,
      storage_path: station.background_url,
      active: true,
      rights_status: 'owned',
    });
  }
}

module.exports = { MediaResolver };
