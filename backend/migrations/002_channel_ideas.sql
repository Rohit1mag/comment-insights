-- Video Ideas step 1: the channel a user has linked, the cached profile we
-- computed for it, and a ledger used to throttle quota-expensive runs.

-- One linked channel per account; re-linking overwrites in place.
create table if not exists user_channels (
  user_email    text primary key,
  channel_id    text not null,
  channel_title text,
  handle        text,
  linked_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Keyed by channel, not by user: two users profiling the same channel (or the
-- same user re-linking) must not pay the ~600 quota units twice.
create table if not exists channel_profiles (
  channel_id  text primary key,
  channel     jsonb not null default '{}'::jsonb,
  top_videos  jsonb not null default '[]'::jsonb,
  profile     jsonb not null default '{}'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

-- One row per computation that actually hit the YouTube API, for the per-user
-- daily cap. Cache hits are deliberately not recorded.
create table if not exists channel_profile_runs (
  id         uuid primary key default gen_random_uuid(),
  user_email text not null,
  channel_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists channel_profile_runs_user_recent
  on channel_profile_runs (user_email, created_at desc);
