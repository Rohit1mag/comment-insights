-- Analysis history: one row per completed analysis, owned by a signed-in user.
create table if not exists analyses (
  id             uuid primary key default gen_random_uuid(),
  user_email     text not null,
  video_id       text not null,
  video_title    text,
  video_url      text,
  total_comments int,
  summary        text,
  sentiment      jsonb,
  action_items   jsonb,
  created_at     timestamptz not null default now()
);

-- Serves the keyset-paginated "my history, newest first" list query.
create index if not exists analyses_user_recent on analyses (user_email, created_at desc);
