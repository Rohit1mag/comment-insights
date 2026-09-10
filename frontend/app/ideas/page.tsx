"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronDown,
  ExternalLink,
  Eye,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
  Video,
  Youtube,
} from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { getApiUrl } from "@/lib/api";
import { consumeSse } from "@/lib/sse";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { StatusBanner } from "@/components/StatusBanner";

interface ChannelSummary {
  channel_id: string;
  title: string;
  handle: string;
  description: string;
  thumbnail: string;
  subscriber_count: number | null;
  video_count: number;
  view_count: number;
  published_at: string;
  url: string;
}

interface TopVideo {
  video_id: string;
  title: string;
  published_at: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  duration_seconds: number;
  thumbnail: string;
  url: string;
}

interface VibeProfile {
  niche: string;
  topics: string[];
  format: string;
  audience: string;
  tone: string;
  summary: string;
  search_queries: string[];
}

interface CompetitorScoreComponents {
  relevance: number;
  size: number;
  exposure: number;
  activity: number;
  queries_matched: number;
  queries_total: number;
  matched_views: number;
}

interface CompetitorChannel {
  channel_id: string;
  title: string;
  handle: string;
  description: string;
  thumbnail: string;
  subscriber_count: number | null;
  video_count: number;
  view_count: number;
  url: string;
  reason: string;
  score: number;
  score_components: CompetitorScoreComponents;
}

interface ChannelProfileResponse {
  channel: ChannelSummary;
  top_videos: TopVideo[];
  vibe: VibeProfile;
  competitors: CompetitorChannel[];
  cached: boolean;
  computed_at: string | null;
}

interface InspiredByVideo {
  channel_title: string;
  video_title: string;
  video_id: string;
  url: string;
  view_count: number;
}

interface VideoIdea {
  title: string;
  hook: string;
  angle: string;
  why_it_works: string;
  inspired_by: InspiredByVideo[];
}

interface SavedChannelResponse {
  channel: ChannelSummary | null;
}

interface ProfileRequestBody {
  channel_input?: string;
  refresh?: boolean;
}

const PROFILE_TIMEOUT_MS = 300000;
const IDEAS_TIMEOUT_MS = 300000;
const STAGE_INTERVAL_MS = 6000;

const LOADING_STAGES = [
  "Finding your channel…",
  "Pulling your top videos…",
  "Reading the vibe…",
  "Scouting competitors…",
  "Ranking the biggest rivals…",
];

const IDEAS_LOADING_STAGES = [
  "Studying competitor hits…",
  "Finding patterns that travel…",
  "Writing ideas for your channel…",
];

const IDEA_SLOT_COUNT = 3;

async function readError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.detail || parsed.message || fallback;
  } catch {
    return text || fallback;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const units: Array<{ limit: number; suffix: string }> = [
    { limit: 1e9, suffix: "B" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "K" },
  ];
  for (const unit of units) {
    if (Math.abs(value) >= unit.limit) {
      const scaled = value / unit.limit;
      const rounded = scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1));
      return `${rounded}${unit.suffix}`;
    }
  }
  return String(Math.round(value));
}

function subscriberLabel(count: number | null): string {
  return count === null ? "Subscribers hidden" : `${formatCount(count)} subscribers`;
}

function validateChannelInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter your channel URL, @handle, or channel ID.";
  if (/^https?:\/\//i.test(value) && !/(youtube\.com|youtu\.be)/i.test(value)) {
    return "Enter a YouTube channel URL, @handle, or channel ID.";
  }
  return null;
}

function ChannelAvatar({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  if (!src) {
    return (
      <div
        className={`${className} bg-amber-400/10 flex items-center justify-center flex-shrink-0`}
      >
        <Youtube className="h-6 w-6 text-amber-300" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className} object-cover flex-shrink-0 border border-white/10`}
    />
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4 animate-in-2">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-xl bg-white/5" />
          <div className="flex-1 space-y-3">
            <div className="h-5 w-1/3 animate-pulse rounded-md bg-white/5" />
            <div className="h-4 w-1/4 animate-pulse rounded-md bg-white/5" />
          </div>
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
        <div className="h-4 w-3/4 animate-pulse rounded-md bg-white/5" />
        <div className="h-4 w-2/3 animate-pulse rounded-md bg-white/5" />
        <div className="flex gap-2 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-20 animate-pulse rounded-full bg-white/5" />
          ))}
        </div>
      </div>
      <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03]"
          />
        ))}
      </div>
    </div>
  );
}

function VibeRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-white/[0.06] py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </span>
      <span className="text-sm leading-relaxed text-white/75">{value}</span>
    </div>
  );
}

export default function IdeasPage() {
  const { isSignedIn, isLoaded: authLoaded } = useUser();
  const { getToken } = useAuth();

  const [channel, setChannel] = useState<ChannelSummary | null>(null);
  const [profile, setProfile] = useState<ChannelProfileResponse | null>(null);
  const [ideas, setIdeas] = useState<VideoIdea[]>([]);
  const [channelInput, setChannelInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasStatus, setIdeasStatus] = useState("");
  const [stageIndex, setStageIndex] = useState(0);
  const [ideasStageIndex, setIdeasStageIndex] = useState(0);
  const [error, setError] = useState("");
  const [ideasError, setIdeasError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadIdeas = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      setIdeasLoading(true);
      setIdeas([]);
      setIdeasStageIndex(0);
      setIdeasStatus(IDEAS_LOADING_STAGES[0]);
      setIdeasError("");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IDEAS_TIMEOUT_MS);

      try {
        const token = await getToken();
        if (!token) throw new Error("Sign in required");

        const response = await fetch(`${getApiUrl()}/channel/ideas/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
          body: JSON.stringify(options),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await readError(response, "Failed to generate video ideas"));
        }

        let streamError: string | null = null;

        await consumeSse(response, {
          status: (payload) => {
            const data = payload as { message?: string; stage?: string };
            if (data?.message) {
              setIdeasStatus(data.message);
              if (data.stage === "writing") setIdeasStageIndex(2);
              else if (data.stage === "competitors") setIdeasStageIndex(0);
            }
          },
          idea: (payload) => {
            const data = payload as { idea?: VideoIdea };
            if (!data?.idea?.title) return;
            setIdeas((prev) => [...prev, data.idea as VideoIdea]);
            setIdeasStatus("Writing ideas for your channel…");
            setIdeasStageIndex(2);
          },
          error: (payload) => {
            const data = payload as { detail?: string };
            streamError = data?.detail || "Failed to generate video ideas";
          },
          done: () => {
            setIdeasStatus("");
          },
        });

        if (streamError) {
          throw new Error(streamError);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setIdeasError("Idea generation took too long. Please try again.");
        } else {
          setIdeasError(
            err instanceof Error ? err.message : "Failed to generate video ideas"
          );
        }
      } finally {
        clearTimeout(timeoutId);
        setIdeasLoading(false);
        setIdeasStatus("");
      }
    },
    [getToken]
  );

  const loadProfile = useCallback(
    async (options: ProfileRequestBody) => {
      setProfileLoading(true);
      setStageIndex(0);
      setError("");
      setIdeas([]);
      setIdeasError("");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);

      try {
        const token = await getToken();
        if (!token) throw new Error("Sign in required");

        const response = await fetch(`${getApiUrl()}/channel/profile`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
          body: JSON.stringify(options),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await readError(response, "Failed to profile your channel"));
        }

        const data: ChannelProfileResponse = await response.json();
        setProfile(data);
        setChannel(data.channel);
        setShowInput(false);
        if ((data.competitors?.length ?? 0) > 0) {
          void loadIdeas({ refresh: Boolean(options.refresh) });
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("That took too long. Please try again.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to profile your channel");
        }
      } finally {
        clearTimeout(timeoutId);
        setProfileLoading(false);
      }
    },
    [getToken, loadIdeas]
  );

  useEffect(() => {
    if (!authLoaded) return;

    if (!isSignedIn) {
      setChannel(null);
      setProfile(null);
      setIdeas([]);
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    setBootstrapping(true);
    setError("");

    const bootstrap = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Sign in required");

        const response = await fetch(`${getApiUrl()}/channel/me`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(await readError(response, "Failed to load your channel"));
        }

        const data: SavedChannelResponse = await response.json();
        if (cancelled) return;

        if (data.channel) {
          setChannel(data.channel);
          void loadProfile({});
        } else {
          setShowInput(true);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load your channel");
        setShowInput(true);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [authLoaded, isSignedIn, getToken, loadProfile]);

  useEffect(() => {
    if (!profileLoading) return;

    const timer = setInterval(() => {
      setStageIndex((prev) => (prev >= LOADING_STAGES.length - 1 ? prev : prev + 1));
    }, STAGE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [profileLoading]);

  useEffect(() => {
    if (!ideasLoading) return;

    const timer = setInterval(() => {
      setIdeasStageIndex((prev) =>
        prev >= IDEAS_LOADING_STAGES.length - 1 ? prev : prev + 1
      );
    }, STAGE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [ideasLoading]);

  const handleResolve = async () => {
    const validation = validateChannelInput(channelInput);
    if (validation) {
      setError(validation);
      return;
    }

    setResolving(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in required");

      const response = await fetch(`${getApiUrl()}/channel/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify({ input: channelInput.trim() }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "We couldn't find that channel"));
      }

      const resolved: ChannelSummary = await response.json();
      setChannel(resolved);
      setProfile(null);
      setIdeas([]);
      setShowInput(false);
      setChannelInput("");
      await loadProfile({});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "We couldn't find that channel");
    } finally {
      setResolving(false);
    }
  };

  const handleChangeChannel = () => {
    setShowInput(true);
    setError("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleRetry = () => {
    setError("");
    if (channel) {
      void loadProfile({});
    } else {
      handleChangeChannel();
    }
  };

  const busy = resolving || profileLoading || ideasLoading;
  const competitors = profile?.competitors ?? [];
  const topVideos = profile?.top_videos ?? [];
  const vibe = profile?.vibe;

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-4xl">
          <PageHeader
            title="Ideas"
            description="Profile your channel, study the rivals in your niche, and get three video ideas written for your vibe."
          />

          {error ? (
            <StatusBanner
              variant="error"
              className="mb-6"
              action={
                <Button onClick={handleRetry} disabled={busy} variant="outline" size="sm">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              }
            >
              {error}
            </StatusBanner>
          ) : null}

          <SignedOut>
            <Card className="animate-in-2">
              <CardHeader>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                  <Lightbulb className="h-5 w-5 text-amber-300" />
                </div>
                <CardTitle className="mb-2 font-display text-2xl font-medium">
                  Sign in to profile your channel
                </CardTitle>
                <CardDescription>
                  We read niche, tone, and format, then surface the channels fighting for the
                  same audience.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <SignInButton mode="modal">
                    <Button variant="outline">Sign in</Button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <Button>Sign up free</Button>
                  </SignUpButton>
                </div>
              </CardContent>
            </Card>
          </SignedOut>

          <SignedIn>
            {bootstrapping ? (
              <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <span className="text-sm">Loading your channel…</span>
              </div>
            ) : (
              <div className="space-y-6">
                {channel && !showInput && (
                  <Card className="animate-in-2 overflow-hidden">
                    <CardContent className="p-6">
                      <div className="flex flex-wrap items-center gap-4">
                        <ChannelAvatar
                          src={channel.thumbnail}
                          alt={`${channel.title} channel avatar`}
                          className="h-16 w-16 rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <a
                            href={channel.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-xl font-semibold text-white transition-colors hover:text-amber-200"
                          >
                            {channel.title}
                            <ExternalLink className="h-4 w-4 text-white/35" />
                          </a>
                          {channel.handle ? (
                            <p className="mt-0.5 text-sm text-white/40">{channel.handle}</p>
                          ) : null}
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-amber-300" />
                              {subscriberLabel(channel.subscriber_count)}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Video className="h-3.5 w-3.5 text-white/40" />
                              {formatCount(channel.video_count)} videos
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Eye className="h-3.5 w-3.5 text-white/40" />
                              {formatCount(channel.view_count)} views
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={handleChangeChannel}
                            disabled={busy}
                            variant="outline"
                            size="sm"
                          >
                            Change channel
                          </Button>
                          <Button
                            onClick={() => loadProfile({ refresh: true })}
                            disabled={busy}
                            size="sm"
                          >
                            {profileLoading ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Refresh
                          </Button>
                        </div>
                      </div>

                      {profile && !profileLoading ? (
                        <p className="mt-5 text-xs text-white/40">
                          {profile.cached && profile.computed_at
                            ? `Profiled ${formatRelative(profile.computed_at)} · Refresh for the latest`
                            : "Freshly profiled just now"}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                )}

                {showInput && (
                  <div className="animate-in-2">
                    {!channel && (
                      <div className="mb-8 text-center">
                        <Badge className="mb-5">Competitor discovery</Badge>
                        <h3 className="mb-2 text-2xl font-semibold tracking-tight text-white">
                          Which channel is yours?
                        </h3>
                        <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                          Paste your channel URL, handle or ID. We only need it once — it gets
                          saved to your account.
                        </p>
                      </div>
                    )}
                    <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center">
                      <Input
                        ref={inputRef}
                        type="text"
                        placeholder="youtube.com/@yourhandle"
                        value={channelInput}
                        onChange={(e) => setChannelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !busy) handleResolve();
                        }}
                        disabled={busy}
                        className="h-12"
                      />
                      <Button onClick={handleResolve} disabled={busy} size="lg" className="h-12 px-6">
                        {resolving ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Finding
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Profile channel
                          </>
                        )}
                      </Button>
                    </div>
                    {channel ? (
                      <div className="mt-4 flex justify-center">
                        <button
                          onClick={() => {
                            setShowInput(false);
                            setError("");
                          }}
                          className="cursor-pointer text-sm text-white/40 transition-colors hover:text-white/70"
                        >
                          Keep {channel.title}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}

                {profileLoading ? (
                  <>
                    <StatusBanner variant="info">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      <span>{LOADING_STAGES[stageIndex]}</span>
                    </StatusBanner>
                    <ProfileSkeleton />
                  </>
                ) : null}

                {!profileLoading && profile && (
                  <>
                    {vibe && (
                      <Card className="animate-in-3 overflow-hidden">
                        <CardHeader className="border-b border-white/[0.06]">
                          <div className="flex items-center gap-3.5">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10">
                              <Sparkles className="h-5 w-5 text-amber-300" />
                            </div>
                            <div>
                              <CardTitle className="mb-1">Your vibe</CardTitle>
                              <CardDescription>
                                What your recent uploads say about the channel
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {vibe.summary ? (
                            <p className="mb-5 text-sm leading-relaxed text-white/75 sm:text-base">
                              {vibe.summary}
                            </p>
                          ) : null}
                          {vibe.niche ? (
                            <p className="mb-5 text-xl font-semibold text-white">{vibe.niche}</p>
                          ) : null}
                          {vibe.topics.length > 0 ? (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {vibe.topics.map((topic) => (
                                <Badge key={topic} variant="secondary">
                                  {topic}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-6">
                            <VibeRow label="Format" value={vibe.format} />
                            <VibeRow label="Audience" value={vibe.audience} />
                            <VibeRow label="Tone" value={vibe.tone} />
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {topVideos.length > 0 ? (
                      <Card className="animate-in-4 overflow-hidden">
                        <CardHeader className="border-b border-white/[0.06]">
                          <CardTitle className="mb-1">Top videos</CardTitle>
                          <CardDescription>
                            Your most-watched uploads, ranked
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-3 sm:p-4">
                          <div className="space-y-0.5">
                            {topVideos.map((video, index) => (
                              <a
                                key={video.video_id}
                                href={video.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                              >
                                <span className="w-7 shrink-0 text-center text-xs font-semibold tabular-nums text-white/35">
                                  {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
                                  {video.title}
                                </span>
                                <span className="hidden shrink-0 items-center gap-1.5 text-sm tabular-nums text-muted-foreground sm:flex">
                                  <Eye className="h-3.5 w-3.5 text-white/40" />
                                  {formatCount(video.view_count)}
                                </span>
                                <span className="w-16 shrink-0 text-right text-xs text-white/40">
                                  {formatRelative(video.published_at)}
                                </span>
                              </a>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="animate-in-4 overflow-hidden">
                        <CardHeader>
                          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                            <Video className="h-5 w-5 text-amber-300" />
                          </div>
                          <CardTitle className="mb-2 text-2xl">
                            We couldn&apos;t find public videos on that channel
                          </CardTitle>
                          <CardDescription>
                            Private, unlisted or members-only uploads stay hidden from the API. If
                            this isn&apos;t your channel, point us at the right one.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Button onClick={handleChangeChannel}>
                            Change channel
                          </Button>
                        </CardContent>
                      </Card>
                    )}

                    <div className="animate-in-5">
                      <div className="mb-5">
                        <h3 className="mb-1 text-xl font-semibold text-white">Your biggest rivals</h3>
                        <p className="text-sm text-muted-foreground">
                          Channels chasing the same audience with the same kind of content.
                        </p>
                      </div>
                      {competitors.length > 0 && (
                        <div className="grid gap-6 md:grid-cols-3">
                          {competitors.map((competitor) => (
                            <Card
                              key={competitor.channel_id}
                              className="flex flex-col overflow-hidden transition-colors hover:border-amber-400/25 hover:bg-white/[0.05]"
                            >
                              <CardHeader className="p-6 pb-4">
                                <div className="flex items-start gap-4">
                                  <ChannelAvatar
                                    src={competitor.thumbnail}
                                    alt={`${competitor.title} channel avatar`}
                                    className="h-12 w-12 rounded-xl"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <CardTitle className="text-base font-bold text-white truncate">
                                      {competitor.title}
                                    </CardTitle>
                                    {competitor.handle && (
                                      <p className="text-xs text-white/40 truncate mt-0.5">
                                        {competitor.handle}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </CardHeader>
                              <CardContent className="p-6 pt-0 flex flex-col flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-4">
                                  <Badge
                                    variant="secondary"
                                    className="bg-white/5 text-white/75 border-white/10 rounded-full px-2.5 py-0.5 text-xs font-medium"
                                  >
                                    {subscriberLabel(competitor.subscriber_count)}
                                  </Badge>
                                  <Badge
                                    variant="secondary"
                                    className="bg-amber-500/10 text-amber-200 border-amber-400/30 rounded-full px-2.5 py-0.5 text-xs font-medium"
                                  >
                                    Score {competitor.score.toFixed(2)}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                                  {competitor.reason}
                                </p>
                                <details className="group mt-4">
                                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-white/40 transition-colors hover:text-white/70">
                                    <ChevronDown className="details-chevron h-3 w-3 transition-transform" />
                                    Why this ranking
                                  </summary>
                                  <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                                    <div className="flex justify-between gap-3">
                                      <dt>Relevance</dt>
                                      <dd className="text-white/75">
                                        {competitor.score_components.relevance.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Size</dt>
                                      <dd className="text-white/75">
                                        {competitor.score_components.size.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Exposure</dt>
                                      <dd className="text-white/75">
                                        {competitor.score_components.exposure.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Activity</dt>
                                      <dd className="text-white/75">
                                        {competitor.score_components.activity.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Queries matched</dt>
                                      <dd className="text-white/75">
                                        {competitor.score_components.queries_matched} /{" "}
                                        {competitor.score_components.queries_total}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Matched views</dt>
                                      <dd className="text-white/75">
                                        {formatCount(competitor.score_components.matched_views)}
                                      </dd>
                                    </div>
                                  </dl>
                                </details>
                                <a
                                  href={competitor.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 mt-5 text-sm font-semibold text-amber-200 hover:text-amber-100 transition-colors"
                                >
                                  Open channel
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                      {competitors.length < 3 && (
                        <p className="text-sm text-white/40 mt-6">
                          Discovery found fewer than three strong matches for this channel.
                        </p>
                      )}
                    </div>

                    {competitors.length > 0 && (
                      <div className="mt-10 animate-in-5">
                        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                          <div>
                            <h3 className="mb-1 text-xl font-semibold text-white">
                              Video ideas for you
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              Adapted from each rival&apos;s top 10 — written for your vibe, not
                              copied from theirs.
                            </p>
                          </div>
                          {!ideasLoading ? (
                            <Button
                              onClick={() => void loadIdeas({ refresh: true })}
                              disabled={busy}
                              variant="outline"
                              size="sm"
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Refresh ideas
                            </Button>
                          ) : null}
                        </div>

                        {ideasError ? (
                          <StatusBanner
                            variant="error"
                            className="mb-6"
                            action={
                              <Button
                                onClick={() => void loadIdeas({})}
                                disabled={busy}
                                variant="outline"
                                size="sm"
                              >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Retry
                              </Button>
                            }
                          >
                            {ideasError}
                          </StatusBanner>
                        ) : null}

                        {ideasLoading ? (
                          <StatusBanner variant="info" className="mb-6">
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                            <span>
                              {ideasStatus || IDEAS_LOADING_STAGES[ideasStageIndex]}
                            </span>
                          </StatusBanner>
                        ) : null}

                        {(ideas.length > 0 || ideasLoading) && (
                          <div className="grid gap-4 md:grid-cols-3">
                            {ideas.map((idea, index) => (
                              <Card
                                key={`${idea.title}-${index}`}
                                className="flex flex-col overflow-hidden animate-in-2 transition-colors hover:border-amber-400/20 hover:bg-white/[0.05]"
                              >
                                <CardHeader className="pb-3">
                                  <div className="mb-3 flex items-center gap-2.5">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                                      <Lightbulb className="h-4 w-4 text-amber-300" />
                                    </div>
                                    <Badge className="border-amber-400/25 bg-amber-500/10 text-amber-200">
                                      Idea {index + 1}
                                    </Badge>
                                  </div>
                                  <CardTitle className="text-base leading-snug text-white">
                                    {idea.title}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-1 flex-col space-y-4 pt-0">
                                  {idea.hook && (
                                    <div>
                                      <p className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-1">
                                        Hook
                                      </p>
                                      <p className="text-sm text-white/75 leading-relaxed">
                                        {idea.hook}
                                      </p>
                                    </div>
                                  )}
                                  {idea.angle && (
                                    <div>
                                      <p className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-1">
                                        Your angle
                                      </p>
                                      <p className="text-sm text-white/75 leading-relaxed">
                                        {idea.angle}
                                      </p>
                                    </div>
                                  )}
                                  {idea.why_it_works && (
                                    <div>
                                      <p className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-1">
                                        Why it works
                                      </p>
                                      <p className="text-sm text-muted-foreground leading-relaxed">
                                        {idea.why_it_works}
                                      </p>
                                    </div>
                                  )}
                                  {idea.inspired_by.length > 0 && (
                                    <div className="pt-2 border-t border-white/5 mt-auto">
                                      <p className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-2">
                                        Inspired by
                                      </p>
                                      <ul className="space-y-2">
                                        {idea.inspired_by.map((ref) => {
                                          const key = `${ref.video_id}-${ref.video_title}`;
                                          const label = ref.channel_title
                                            ? `${ref.channel_title}: ${ref.video_title}`
                                            : ref.video_title;
                                          if (ref.url) {
                                            return (
                                              <li key={key}>
                                                <a
                                                  href={ref.url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-xs text-amber-200 hover:text-amber-100 transition-colors inline-flex items-start gap-1.5"
                                                >
                                                  <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                                  <span>{label}</span>
                                                </a>
                                              </li>
                                            );
                                          }
                                          return (
                                            <li key={key} className="text-xs text-muted-foreground">
                                              {label}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            ))}
                            {ideasLoading &&
                              Array.from({
                                length: Math.max(0, IDEA_SLOT_COUNT - ideas.length),
                              }).map((_, i) => (
                                <div
                                  key={`idea-skeleton-${ideas.length + i}`}
                                  className="h-52 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03]"
                                />
                              ))}
                          </div>
                        )}

                        {!ideasLoading && !ideasError && ideas.length === 0 && (
                          <p className="text-sm text-white/40">
                            No ideas yet. Hit refresh once competitors are ready.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </SignedIn>
        </div>
      </main>
    </AppShell>
  );
}
