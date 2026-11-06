"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
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
import { IdeaCard, IdeaSkeleton, type VideoIdea } from "@/components/IdeaCard";
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

const EMPTY_VIBE: VibeProfile = {
  niche: "",
  topics: [],
  format: "",
  audience: "",
  tone: "",
  summary: "",
  search_queries: [],
};

function clipReasoning(prev: string, text: string) {
  const next = `${prev}${text}`.replace(/\s+/g, " ").trim();
  return next.length > 220 ? `…${next.slice(-219)}` : next;
}

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
  const [draftIdea, setDraftIdea] = useState<Partial<VideoIdea> | null>(null);
  const [channelInput, setChannelInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasStatus, setIdeasStatus] = useState("");
  const [ideasReasoning, setIdeasReasoning] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [profileReasoning, setProfileReasoning] = useState("");
  const [stageIndex, setStageIndex] = useState(0);
  const [ideasStageIndex, setIdeasStageIndex] = useState(0);
  const [error, setError] = useState("");
  const [ideasError, setIdeasError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ideasAbortRef = useRef<AbortController | null>(null);

  const loadIdeas = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      ideasAbortRef.current?.abort();
      const controller = new AbortController();
      ideasAbortRef.current = controller;

      setIdeasLoading(true);
      setIdeas([]);
      setDraftIdea(null);
      setIdeasStageIndex(0);
      setIdeasStatus(IDEAS_LOADING_STAGES[0]);
      setIdeasReasoning("");
      setIdeasError("");

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
              setIdeasReasoning("");
              if (data.stage === "writing") setIdeasStageIndex(2);
              else if (data.stage === "competitors") setIdeasStageIndex(0);
            }
          },
          reasoning_delta: (payload) => {
            const text = (payload as { text?: string })?.text ?? "";
            if (!text) return;
            setIdeasReasoning((prev) => clipReasoning(prev, text));
          },
          idea_partial: (payload) => {
            const data = payload as { idea?: Partial<VideoIdea> };
            if (!data?.idea) return;
            startTransition(() => {
              setDraftIdea(data.idea as Partial<VideoIdea>);
              setIdeasStatus("Writing ideas for your channel…");
              setIdeasStageIndex(2);
            });
          },
          idea: (payload) => {
            const data = payload as { idea?: VideoIdea };
            if (!data?.idea?.title) return;
            startTransition(() => {
              setIdeas((prev) => [...prev, data.idea as VideoIdea]);
              setDraftIdea(null);
              setIdeasStatus("Writing ideas for your channel…");
              setIdeasStageIndex(2);
            });
          },
          error: (payload) => {
            const data = payload as { detail?: string };
            streamError = data?.detail || "Failed to generate video ideas";
          },
          done: () => {
            setIdeasStatus("");
            setIdeasReasoning("");
            setDraftIdea(null);
          },
        });

        if (streamError) {
          throw new Error(streamError);
        }
      } catch (err: unknown) {
        if (ideasAbortRef.current !== controller) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setIdeasError("Idea generation took too long. Please try again.");
        } else {
          setIdeasError(
            err instanceof Error ? err.message : "Failed to generate video ideas"
          );
        }
      } finally {
        clearTimeout(timeoutId);
        if (ideasAbortRef.current === controller) {
          setIdeasLoading(false);
          setIdeasStatus("");
          setIdeasReasoning("");
          setDraftIdea(null);
        }
      }
    },
    [getToken]
  );

  const loadProfile = useCallback(
    async (options: ProfileRequestBody) => {
      setProfileLoading(true);
      setStageIndex(0);
      setProfileStatus(LOADING_STAGES[0]);
      setProfileReasoning("");
      setError("");
      setProfile(null);
      setIdeas([]);
      setDraftIdea(null);
      setIdeasError("");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);

      try {
        const token = await getToken();
        if (!token) throw new Error("Sign in required");

        const response = await fetch(`${getApiUrl()}/channel/profile/stream`, {
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

        const latest: { profile: ChannelProfileResponse | null } = { profile: null };
        let streamError: string | null = null;

        await consumeSse(response, {
          status: (payload) => {
            const data = payload as { message?: string };
            if (data?.message) {
              setProfileStatus(data.message);
              setProfileReasoning("");
            }
          },
          reasoning_delta: (payload) => {
            const text = (payload as { text?: string })?.text ?? "";
            if (!text) return;
            setProfileReasoning((prev) => clipReasoning(prev, text));
          },
          channel: (payload) => {
            const data = payload as { channel?: ChannelSummary; top_videos?: TopVideo[] };
            if (!data?.channel) return;
            setChannel(data.channel);
            setShowInput(false);
            setProfile({
              channel: data.channel,
              top_videos: data.top_videos ?? [],
              vibe: EMPTY_VIBE,
              competitors: [],
              cached: false,
              computed_at: null,
            });
          },
          vibe_partial: (payload) => {
            const partial = (payload || {}) as Partial<VibeProfile>;
            setProfile((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                vibe: {
                  ...prev.vibe,
                  ...partial,
                  topics: Array.isArray(partial.topics) ? partial.topics : prev.vibe.topics,
                  search_queries: prev.vibe.search_queries,
                },
              };
            });
          },
          vibe: (payload) => {
            const vibe = payload as VibeProfile;
            if (!vibe) return;
            setProfile((prev) => (prev ? { ...prev, vibe } : prev));
          },
          profile: (payload) => {
            const data = payload as ChannelProfileResponse;
            if (!data?.channel) return;
            latest.profile = data;
            setProfile(data);
            setChannel(data.channel);
            setShowInput(false);
          },
          error: (payload) => {
            const data = payload as { detail?: string };
            streamError = data?.detail || "Failed to profile your channel";
          },
          done: () => {
            setProfileReasoning("");
          },
        });

        if (streamError) {
          throw new Error(streamError);
        }
        if ((latest.profile?.competitors?.length ?? 0) > 0) {
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
        setProfileReasoning("");
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
      setDraftIdea(null);
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
    return () => {
      ideasAbortRef.current?.abort();
    };
  }, []);

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
      setDraftIdea(null);
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
  const hasVibe = Boolean(
    vibe &&
      (vibe.summary ||
        vibe.niche ||
        vibe.format ||
        vibe.audience ||
        vibe.tone ||
        vibe.topics.length > 0)
  );
  const showIdeas =
    competitors.length > 0 || ideas.length > 0 || ideasLoading || Boolean(ideasError);
  const ideasProgress = Math.min(
    100,
    Math.round(((ideas.length + (draftIdea ? 0.45 : 0)) / IDEA_SLOT_COUNT) * 100)
  );

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-4xl">
          <PageHeader
            title="Ideas"
            description="Profile your channel, then watch three video ideas write themselves from what is already winning in your niche."
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
                  <StatusBanner variant="info">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span>{profileReasoning || profileStatus || LOADING_STAGES[stageIndex]}</span>
                  </StatusBanner>
                ) : null}

                {profileLoading && !profile ? <ProfileSkeleton /> : null}

                {profile && (
                  <>
                    {showIdeas ? (
                      <div className="animate-in-3">
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
                          <div className="mb-6 space-y-3">
                            <StatusBanner variant="info">
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                              <span>
                                {ideas.length > 0 || draftIdea
                                  ? `Writing idea ${Math.min(ideas.length + 1, IDEA_SLOT_COUNT)} of ${IDEA_SLOT_COUNT}…`
                                  : ideasReasoning ||
                                    ideasStatus ||
                                    IDEAS_LOADING_STAGES[ideasStageIndex]}
                              </span>
                            </StatusBanner>
                            <div
                              className="h-1 overflow-hidden rounded-full bg-white/5"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={ideasProgress}
                              aria-label="Idea generation progress"
                            >
                              <div
                                className="h-full rounded-full bg-amber-400/80 transition-[width] duration-300"
                                style={{ width: `${Math.max(8, ideasProgress)}%` }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {(ideas.length > 0 || ideasLoading) && (
                          <div
                            className="grid gap-4 md:grid-cols-3"
                            aria-live="polite"
                            aria-busy={ideasLoading}
                          >
                            {ideas.map((idea, index) => (
                              <IdeaCard
                                key={`${idea.title}-${index}`}
                                idea={idea}
                                index={index}
                              />
                            ))}
                            {ideasLoading && draftIdea ? (
                              <IdeaCard
                                idea={draftIdea}
                                index={ideas.length}
                                streaming
                              />
                            ) : null}
                            {ideasLoading &&
                              Array.from({
                                length: Math.max(
                                  0,
                                  IDEA_SLOT_COUNT - ideas.length - (draftIdea ? 1 : 0)
                                ),
                              }).map((_, i) => (
                                <IdeaSkeleton
                                  key={`idea-skeleton-${ideas.length + i}`}
                                  label={
                                    i === 0 && !draftIdea
                                      ? "Waiting for the first line…"
                                      : "Up next"
                                  }
                                />
                              ))}
                          </div>
                        )}

                        {!ideasLoading && !ideasError && ideas.length === 0 ? (
                          <p className="text-sm text-white/40">
                            No ideas yet. Hit refresh once competitors are ready.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {hasVibe && vibe && (
                      <Card className="animate-in-4 overflow-hidden">
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
                                    <CardTitle className="truncate text-base font-bold text-white">
                                      {competitor.title}
                                    </CardTitle>
                                    {competitor.handle && (
                                      <p className="mt-0.5 truncate text-xs text-white/40">
                                        {competitor.handle}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </CardHeader>
                              <CardContent className="flex flex-1 flex-col p-6 pt-0">
                                <div className="mb-4 flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-white/75"
                                  >
                                    {subscriberLabel(competitor.subscriber_count)}
                                  </Badge>
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-200"
                                  >
                                    Score {competitor.score.toFixed(2)}
                                  </Badge>
                                </div>
                                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
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
                                  className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-amber-200 transition-colors hover:text-amber-100"
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
                        <p className="mt-6 text-sm text-white/40">
                          Discovery found fewer than three strong matches for this channel.
                        </p>
                      )}
                    </div>

                    {topVideos.length > 0 ? (
                      <Card className="animate-in-5 overflow-hidden">
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
                      <Card className="animate-in-5 overflow-hidden">
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
