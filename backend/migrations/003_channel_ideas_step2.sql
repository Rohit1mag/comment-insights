-- Video Ideas step 2: cache recommended ideas (and the competitor top-video
-- packages they were derived from) alongside the step-1 channel profile.

alter table channel_profiles
  add column if not exists ideas jsonb not null default '[]'::jsonb,
  add column if not exists competitor_videos jsonb not null default '[]'::jsonb,
  add column if not exists ideas_computed_at timestamptz;
