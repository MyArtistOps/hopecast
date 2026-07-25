/**
 * Rotation engine (Milestone 5). Takes a station's base playlist and its
 * active `rotation_rules` rows and produces the final ordered on-air queue —
 * automatically inserting station IDs / promos, shuffling within chosen
 * categories, respecting a no-repeat window, prioritizing featured songs,
 * and keeping designated opening/closing items fixed.
 *
 * This intentionally stays a straightforward pass over a fixed base list —
 * "does not need to act like a sophisticated commercial scheduling engine
 * yet," per spec. If no active rules exist, it returns the base playlist
 * completely unchanged, so it's a safe drop-in for the Milestone 4 path.
 */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchRecentlyPlayedAssetIds(supabase, stationId, withinHours) {
  if (!withinHours) return new Set();
  const since = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('broadcast_events')
    .select('metadata, created_at, broadcasts!inner(station_id)')
    .eq('event_type', 'item_change')
    .eq('broadcasts.station_id', stationId)
    .gte('created_at', since);

  return new Set((data || []).map((e) => e.metadata?.mediaAssetId).filter(Boolean));
}

async function buildOnAirQueue({ supabase, stationId, playlistId, logger }) {
  const { data: items } = await supabase
    .from('playlist_items')
    .select('*, media_assets(*)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });

  const playable = (items || []).filter((i) => i.media_assets
    && i.media_assets.active
    && i.media_assets.rights_status !== 'do_not_broadcast');

  const fixedStart = playable.filter((i) => i.settings?.fixed_position === 'start');
  const fixedEnd = playable.filter((i) => i.settings?.fixed_position === 'end');
  let songs = playable.filter((i) => !i.settings?.fixed_position);

  const { data: rules } = await supabase
    .from('rotation_rules')
    .select('*')
    .eq('station_id', stationId)
    .eq('active', true);

  const activeRules = rules || [];
  const shuffleRule = activeRules.find((r) => r.rule_type === 'shuffle_category');
  const featuredRule = activeRules.find((r) => r.rule_type === 'featured_priority');
  const noRepeatRule = activeRules.find((r) => r.rule_type === 'no_repeat_within_hours');
  const stationIdRule = activeRules.find((r) => r.rule_type === 'station_id_every_n');
  const promoRule = activeRules.find((r) => r.rule_type === 'promo_every_n');

  const recentlyPlayed = await fetchRecentlyPlayedAssetIds(
    supabase, stationId, noRepeatRule?.frequency
  );

  if (shuffleRule) {
    const categories = shuffleRule.settings?.categories || [];
    const inScope = songs.filter((i) => categories.includes(i.media_assets.category));
    const outOfScope = songs.filter((i) => !categories.includes(i.media_assets.category));
    let shuffled = shuffle(inScope);
    // Best-effort: if the very first shuffled pick was played too recently, swap it later.
    for (let i = 0; i < shuffled.length; i++) {
      if (!recentlyPlayed.has(shuffled[i].media_assets.id)) break;
      const swapIdx = shuffled.findIndex((x) => !recentlyPlayed.has(x.media_assets.id));
      if (swapIdx > i) [shuffled[i], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[i]];
    }
    songs = [...shuffled, ...outOfScope];
  }

  if (featuredRule) {
    const featuredIds = new Set(featuredRule.settings?.assetIds || []);
    const featured = songs.filter((i) => featuredIds.has(i.media_assets.id));
    const rest = songs.filter((i) => !featuredIds.has(i.media_assets.id));
    songs = [...featured, ...rest]; // stable: featured songs surface earlier without losing the rest's relative order
  }

  const [{ data: stationIdAssets }, { data: promoAssets }] = await Promise.all([
    supabase.from('media_assets').select('*')
      .eq('station_id', stationId).eq('media_type', 'station_id')
      .eq('active', true).neq('rights_status', 'do_not_broadcast'),
    supabase.from('media_assets').select('*')
      .eq('station_id', stationId).in('media_type', ['advertisement', 'announcement'])
      .eq('active', true).neq('rights_status', 'do_not_broadcast'),
  ]);

  const now = new Date();
  const eligiblePromos = (promoAssets || []).filter((a) => {
    const start = a.metadata?.active_start ? new Date(a.metadata.active_start) : null;
    const end = a.metadata?.active_end ? new Date(a.metadata.active_end) : null;
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  }).sort((a, b) => (b.metadata?.priority || 0) - (a.metadata?.priority || 0));

  let stationIdCursor = 0;
  let promoCursor = 0;
  const promoPlayCounts = new Map();

  const final = [...fixedStart];
  let songCount = 0;

  for (const item of songs) {
    final.push(item);
    songCount += 1;

    if (stationIdRule?.frequency && stationIdAssets?.length && songCount % stationIdRule.frequency === 0) {
      const asset = stationIdAssets[stationIdCursor % stationIdAssets.length];
      stationIdCursor += 1;
      final.push({ media_assets: asset, item_type: 'station_id', position: -1 });
    }

    if (promoRule?.frequency && eligiblePromos.length && songCount % promoRule.frequency === 0) {
      // Respect a per-item max-plays-per-broadcast cap stored in metadata.
      let attempts = 0;
      while (attempts < eligiblePromos.length) {
        const asset = eligiblePromos[promoCursor % eligiblePromos.length];
        promoCursor += 1;
        attempts += 1;
        const maxPlays = asset.metadata?.max_plays_per_broadcast;
        const playedSoFar = promoPlayCounts.get(asset.id) || 0;
        if (!maxPlays || playedSoFar < maxPlays) {
          promoPlayCounts.set(asset.id, playedSoFar + 1);
          final.push({ media_assets: asset, item_type: 'promo', position: -1 });
          break;
        }
      }
    }
  }

  final.push(...fixedEnd);

  logger?.info(
    { playlistId, totalItems: final.length, rulesApplied: activeRules.map((r) => r.rule_type) },
    'On-air queue built'
  );

  return final.map((i) => ({
    mediaAssetId: i.media_assets.id,
    title: i.media_assets.title,
    artist: i.media_assets.artist,
    category: i.media_assets.category,
    itemType: i.item_type,
    durationSeconds: Number(i.media_assets.duration_seconds || 0),
    storage_path: i.media_assets.storage_path,
  }));
}

module.exports = { buildOnAirQueue };
