-- Milestone 5: document the settings shape each rotation_rules.rule_type
-- expects, so the engine (streaming-worker/src/rotationEngine.js) and any
-- future admin UI stay in sync without needing a schema change per rule.
comment on column rotation_rules.settings is
  'Shape depends on rule_type:
   station_id_every_n -> frequency = every N songs (settings unused)
   promo_every_n       -> frequency = every N songs (settings unused)
   no_repeat_within_hours -> frequency = hours (settings unused)
   shuffle_category    -> settings: {"categories": ["worship","healing"]}
   featured_priority   -> settings: {"assetIds": ["<media_asset uuid>", ...]}';

comment on column playlist_items.settings is
  'Currently supports {"fixed_position": "start"|"end"} to keep an opening
   or closing item fixed regardless of rotation-engine shuffling.';

comment on column media_assets.metadata is
  'For advertisement/announcement items, may include:
   {"active_start": iso date, "active_end": iso date,
    "priority": number, "max_plays_per_broadcast": number}';
