"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExternalLink,
  Eye,
  History,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
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
  UserButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { getApiUrl } from "@/lib/api";

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

interface ChannelIdeasResponse {
  ideas: VideoIdea[];
  competitor_videos: Array<{
    channel_id: string;
    title: string;
    handle: string;
    top_videos: TopVideo[];
  }>;
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
        className={`${className} bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0`}
      >
        <Youtube className="h-6 w-6 text-blue-400" />
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
    <div className="space-y-8 animate-in-2">
      <div className="glass border border-white/10 rounded-3xl p-8">
        <div className="flex items-center gap-5">
          <div className="h-20 w-20 rounded-2xl bg-white/5 animate-pulse" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-1/3 rounded-lg bg-white/5 animate-pulse" />
            <div className="h-4 w-1/4 rounded-lg bg-white/5 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="glass border border-white/10 rounded-3xl p-8 space-y-4">
        <div className="h-4 w-3/4 rounded-lg bg-white/5 animate-pulse" />
        <div className="h-4 w-2/3 rounded-lg bg-white/5 animate-pulse" />
        <div className="flex gap-2 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-7 w-24 rounded-full bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>

      <div className="glass border border-white/10 rounded-3xl p-8 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-2xl bg-white/5 animate-pulse" />
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="glass border border-white/10 rounded-3xl p-6 h-56 bg-white/5 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function VibeRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-3 border-t border-white/5">
      <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold sm:w-24 flex-shrink-0">
        {label}
      </span>
      <span className="text-sm text-gray-300 leading-relaxed">{value}</span>
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
  const [stageIndex, setStageIndex] = useState(0);
  const [ideasStageIndex, setIdeasStageIndex] = useState(0);
  const [error, setError] = useState("");
  const [ideasError, setIdeasError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadIdeas = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      setIdeasLoading(true);
      setIdeasStageIndex(0);
      setIdeasError("");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IDEAS_TIMEOUT_MS);

      try {
        const token = await getToken();
        if (!token) throw new Error("Sign in required");

        const response = await fetch(`${getApiUrl()}/channel/ideas`, {
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

        const data: ChannelIdeasResponse = await response.json();
        setIdeas(data.ideas);
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
    <div className="min-h-screen relative z-10">
      <header className="glass sticky top-0 z-50 border-b border-white/10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-4 animate-in-1">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500 blur-xl opacity-30 rounded-full"></div>
                <Youtube className="h-9 w-9 text-blue-400 relative z-10" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                <span
                  className="gradient-text"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%))",
                    backgroundSize: "200% 200%",
                    animation: "gradient-shift 3s ease infinite",
                  }}
                >
                  Disstill
                </span>
              </h1>
              <Badge
                variant="secondary"
                className="hidden sm:inline-flex bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-3 text-xs font-medium"
              >
                Ideas
              </Badge>
            </Link>
            <div className="flex items-center gap-3">
              <SignedOut>
                <SignInButton>
                  <button className="px-5 py-2.5 text-sm font-semibold text-gray-300 hover:text-white transition-all cursor-pointer rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton>
                  <button className="px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-400 hover:to-purple-400 transition-all cursor-pointer rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30">
                    Get started
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <Link
                  href="/"
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:text-white transition-all cursor-pointer rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5"
                >
                  <Search className="h-4 w-4" />
                  New analysis
                </Link>
                <Link
                  href="/history"
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:text-white transition-all cursor-pointer rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5"
                >
                  <History className="h-4 w-4" />
                  <span className="hidden sm:inline">History</span>
                </Link>
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox:
                        "w-9 h-9 ring-2 ring-blue-400/40 ring-offset-2 ring-offset-[#0a0f1a]",
                    },
                  }}
                />
              </SignedIn>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="mb-10 animate-in-1">
            <h2
              className="text-5xl font-bold mb-4 gradient-text"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%))",
                backgroundSize: "200% 200%",
                animation: "gradient-shift 3s ease infinite",
              }}
            >
              Content Ideas
            </h2>
            <p className="text-gray-400 text-lg">
              Study your rivals&apos; hits, then get three video ideas that fit your channel.
            </p>
          </div>

          {error && (
            <div className="border border-red-400/30 bg-red-500/10 p-4 mb-6 rounded-2xl backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-red-300 font-medium">{error}</p>
              <Button
                onClick={handleRetry}
                disabled={busy}
                className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-200 hover:text-white transition-all duration-300 rounded-xl px-5 py-2"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          )}

          <SignedOut>
            <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-2">
              <CardHeader className="p-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-6">
                  <Lightbulb className="h-8 w-8 text-blue-400" />
                </div>
                <CardTitle className="text-2xl mb-3 font-bold">
                  Sign in to profile your channel
                </CardTitle>
                <CardDescription className="text-gray-400 leading-relaxed">
                  We&apos;ll read your channel&apos;s niche, tone and format, then surface the
                  competitors fighting for the same audience.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-0">
                <div className="flex flex-wrap gap-3">
                  <SignInButton mode="modal">
                    <button className="px-5 py-2.5 text-sm font-semibold text-gray-200 hover:text-white transition-all cursor-pointer rounded-xl border border-white/15 hover:border-white/25 hover:bg-white/5">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-400 hover:to-purple-400 transition-all cursor-pointer rounded-xl shadow-lg shadow-blue-500/25">
                      Sign up free
                    </button>
                  </SignUpButton>
                </div>
              </CardContent>
            </Card>
          </SignedOut>

          <SignedIn>
            {bootstrapping ? (
              <div className="flex items-center justify-center gap-3 text-gray-400 py-16">
                <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                <span>Loading your channel…</span>
              </div>
            ) : (
              <div className="space-y-8">
                {channel && !showInput && (
                  <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-2">
                    <CardContent className="p-8">
                      <div className="flex flex-wrap items-center gap-5">
                        <ChannelAvatar
                          src={channel.thumbnail}
                          alt={`${channel.title} channel avatar`}
                          className="h-20 w-20 rounded-2xl"
                        />
                        <div className="min-w-0 flex-1">
                          <a
                            href={channel.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-2xl font-bold text-white hover:text-blue-300 transition-colors inline-flex items-center gap-2"
                          >
                            {channel.title}
                            <ExternalLink className="h-4 w-4 text-gray-500" />
                          </a>
                          {channel.handle && (
                            <p className="text-sm text-gray-500 mt-1">{channel.handle}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-400">
                            <span className="flex items-center gap-1.5">
                              <Users className="h-4 w-4 text-blue-400" />
                              {subscriberLabel(channel.subscriber_count)}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Video className="h-4 w-4 text-purple-400" />
                              {formatCount(channel.video_count)} videos
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Eye className="h-4 w-4 text-cyan-400" />
                              {formatCount(channel.view_count)} views
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Button
                            onClick={handleChangeChannel}
                            disabled={busy}
                            className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 hover:text-white transition-all duration-300 rounded-xl px-5 py-2.5"
                          >
                            Change channel
                          </Button>
                          <Button
                            onClick={() => loadProfile({ refresh: true })}
                            disabled={busy}
                            className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white font-semibold rounded-xl px-5 py-2.5 shadow-lg shadow-blue-500/25 transition-all duration-300"
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

                      {profile && !profileLoading && (
                        <p className="text-xs text-gray-500 mt-6">
                          {profile.cached && profile.computed_at
                            ? `Profiled ${formatRelative(profile.computed_at)} · Refresh for the latest`
                            : "Freshly profiled just now"}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {showInput && (
                  <div className="animate-in-2">
                    {!channel && (
                      <div className="text-center mb-8">
                        <Badge
                          className="mb-6 bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-4 py-1.5 text-sm font-medium"
                          variant="secondary"
                        >
                          Competitor Discovery
                        </Badge>
                        <h3 className="text-3xl font-bold mb-3 text-gray-200">
                          Which channel is yours?
                        </h3>
                        <p className="text-gray-400 max-w-xl mx-auto leading-relaxed">
                          Paste your channel URL, handle or ID. We only need it once — it gets
                          saved to your account.
                        </p>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-3 max-w-3xl mx-auto">
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
                        className="h-14 text-base bg-white/5 border border-white/10 focus:border-blue-400/50 text-white placeholder:text-gray-500 rounded-2xl transition-all duration-300 hover:bg-white/8 focus:bg-white/8 shadow-lg"
                      />
                      <Button
                        onClick={handleResolve}
                        disabled={busy}
                        size="lg"
                        className="px-10 h-14 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white font-semibold text-base rounded-2xl transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40"
                      >
                        {resolving ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Finding
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 h-5 w-5" />
                            Profile channel
                          </>
                        )}
                      </Button>
                    </div>
                    {channel && (
                      <div className="flex justify-center mt-4">
                        <button
                          onClick={() => {
                            setShowInput(false);
                            setError("");
                          }}
                          className="text-sm text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                        >
                          Keep {channel.title}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {profileLoading && (
                  <>
                    <div className="border border-blue-400/30 bg-blue-500/10 p-4 rounded-2xl backdrop-blur-xl">
                      <div className="text-sm text-blue-300 flex items-center gap-3 font-medium">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{LOADING_STAGES[stageIndex]}</span>
                      </div>
                    </div>
                    <ProfileSkeleton />
                  </>
                )}

                {!profileLoading && profile && (
                  <>
                    {vibe && (
                      <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-3">
                        <CardHeader className="p-8 border-b border-white/5">
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center flex-shrink-0">
                              <Sparkles className="h-7 w-7 text-purple-400" />
                            </div>
                            <div>
                              <CardTitle className="text-2xl font-bold mb-1">Your vibe</CardTitle>
                              <CardDescription className="text-gray-400">
                                What your recent uploads say about the channel
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-8">
                          {vibe.summary && (
                            <p className="text-base text-gray-300 leading-relaxed mb-6">
                              {vibe.summary}
                            </p>
                          )}
                          {vibe.niche && (
                            <p className="text-2xl font-bold text-white mb-6">{vibe.niche}</p>
                          )}
                          {vibe.topics.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {vibe.topics.map((topic) => (
                                <Badge
                                  key={topic}
                                  variant="secondary"
                                  className="bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-3 py-1 text-xs font-medium"
                                >
                                  {topic}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="mt-6">
                            <VibeRow label="Format" value={vibe.format} />
                            <VibeRow label="Audience" value={vibe.audience} />
                            <VibeRow label="Tone" value={vibe.tone} />
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {topVideos.length > 0 ? (
                      <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-4">
                        <CardHeader className="p-8 border-b border-white/5">
                          <CardTitle className="text-2xl font-bold mb-1">Top videos</CardTitle>
                          <CardDescription className="text-gray-400">
                            Your most-watched uploads, ranked
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                          <div className="space-y-1">
                            {topVideos.map((video, index) => (
                              <a
                                key={video.video_id}
                                href={video.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-4 p-4 rounded-2xl border border-transparent hover:border-blue-400/30 hover:bg-white/5 transition-all duration-300"
                              >
                                <span className="w-8 text-center text-sm font-bold text-gray-500 flex-shrink-0">
                                  {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-200">
                                  {video.title}
                                </span>
                                <span className="hidden sm:flex items-center gap-1.5 text-sm text-gray-400 flex-shrink-0">
                                  <Eye className="h-4 w-4 text-cyan-400" />
                                  {formatCount(video.view_count)}
                                </span>
                                <span className="text-xs text-gray-500 flex-shrink-0 w-20 text-right">
                                  {formatRelative(video.published_at)}
                                </span>
                              </a>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-4">
                        <CardHeader className="p-8">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6">
                            <Video className="h-8 w-8 text-cyan-400" />
                          </div>
                          <CardTitle className="text-2xl mb-3 font-bold">
                            We couldn&apos;t find public videos on that channel
                          </CardTitle>
                          <CardDescription className="text-gray-400 leading-relaxed">
                            Private, unlisted or members-only uploads stay hidden from the API. If
                            this isn&apos;t your channel, point us at the right one.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-8 pt-0">
                          <Button
                            onClick={handleChangeChannel}
                            className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white font-semibold rounded-xl px-6 py-2.5 shadow-lg shadow-blue-500/25 transition-all duration-300"
                          >
                            Change channel
                          </Button>
                        </CardContent>
                      </Card>
                    )}

                    <div className="animate-in-5">
                      <div className="mb-6">
                        <h3 className="text-2xl font-bold text-white mb-2">Your biggest rivals</h3>
                        <p className="text-gray-400 text-sm">
                          Channels chasing the same audience with the same kind of content.
                        </p>
                      </div>
                      {competitors.length > 0 && (
                        <div className="grid gap-6 md:grid-cols-3">
                          {competitors.map((competitor) => (
                            <Card
                              key={competitor.channel_id}
                              className="glass border-white/10 hover:border-blue-400/30 hover:bg-white/5 transition-all duration-300 rounded-3xl overflow-hidden flex flex-col"
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
                                      <p className="text-xs text-gray-500 truncate mt-0.5">
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
                                    className="bg-white/5 text-gray-300 border-white/10 rounded-full px-2.5 py-0.5 text-xs font-medium"
                                  >
                                    {subscriberLabel(competitor.subscriber_count)}
                                  </Badge>
                                  <Badge
                                    variant="secondary"
                                    className="bg-purple-500/10 text-purple-300 border-purple-400/30 rounded-full px-2.5 py-0.5 text-xs font-medium"
                                  >
                                    Score {competitor.score.toFixed(2)}
                                  </Badge>
                                </div>
                                <p className="text-sm text-gray-400 leading-relaxed flex-1">
                                  {competitor.reason}
                                </p>
                                <details className="group mt-4">
                                  <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors list-none">
                                    Why this ranking
                                  </summary>
                                  <dl className="mt-3 space-y-1.5 text-xs text-gray-400">
                                    <div className="flex justify-between gap-3">
                                      <dt>Relevance</dt>
                                      <dd className="text-gray-300">
                                        {competitor.score_components.relevance.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Size</dt>
                                      <dd className="text-gray-300">
                                        {competitor.score_components.size.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Exposure</dt>
                                      <dd className="text-gray-300">
                                        {competitor.score_components.exposure.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Activity</dt>
                                      <dd className="text-gray-300">
                                        {competitor.score_components.activity.toFixed(2)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Queries matched</dt>
                                      <dd className="text-gray-300">
                                        {competitor.score_components.queries_matched} /{" "}
                                        {competitor.score_components.queries_total}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt>Matched views</dt>
                                      <dd className="text-gray-300">
                                        {formatCount(competitor.score_components.matched_views)}
                                      </dd>
                                    </div>
                                  </dl>
                                </details>
                                <a
                                  href={competitor.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 mt-5 text-sm font-semibold text-blue-300 hover:text-blue-200 transition-colors"
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
                        <p className="text-sm text-gray-500 mt-6">
                          Discovery found fewer than three strong matches for this channel.
                        </p>
                      )}
                    </div>

                    {competitors.length > 0 && (
                      <div className="animate-in-5 mt-12">
                        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                          <div>
                            <h3 className="text-2xl font-bold text-white mb-2">
                              Video ideas for you
                            </h3>
                            <p className="text-gray-400 text-sm">
                              Adapted from each rival&apos;s top 10 — written for your vibe, not
                              copied from theirs.
                            </p>
                          </div>
                          {!ideasLoading && (
                            <Button
                              onClick={() => void loadIdeas({ refresh: true })}
                              disabled={busy}
                              className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-200 hover:text-white transition-all duration-300 rounded-xl px-5 py-2"
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Refresh ideas
                            </Button>
                          )}
                        </div>

                        {ideasError && (
                          <div className="border border-red-400/30 bg-red-500/10 p-4 mb-6 rounded-2xl backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm text-red-300 font-medium">{ideasError}</p>
                            <Button
                              onClick={() => void loadIdeas({})}
                              disabled={busy}
                              className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-200 hover:text-white transition-all duration-300 rounded-xl px-5 py-2"
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Retry
                            </Button>
                          </div>
                        )}

                        {ideasLoading && (
                          <div className="space-y-4">
                            <div className="border border-blue-400/30 bg-blue-500/10 p-4 rounded-2xl backdrop-blur-xl">
                              <div className="text-sm text-blue-300 flex items-center gap-3 font-medium">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>{IDEAS_LOADING_STAGES[ideasStageIndex]}</span>
                              </div>
                            </div>
                            <div className="grid gap-6 md:grid-cols-3">
                              {[0, 1, 2].map((i) => (
                                <div
                                  key={i}
                                  className="glass border border-white/10 rounded-3xl p-6 h-64 bg-white/5 animate-pulse"
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {!ideasLoading && ideas.length > 0 && (
                          <div className="grid gap-6 md:grid-cols-3">
                            {ideas.map((idea, index) => (
                              <Card
                                key={`${idea.title}-${index}`}
                                className="glass border-white/10 hover:border-blue-400/30 hover:bg-white/5 transition-all duration-300 rounded-3xl overflow-hidden flex flex-col"
                              >
                                <CardHeader className="p-6 pb-3">
                                  <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center flex-shrink-0">
                                      <Lightbulb className="h-5 w-5 text-amber-300" />
                                    </div>
                                    <Badge
                                      variant="secondary"
                                      className="bg-amber-500/10 text-amber-200 border-amber-400/30 rounded-full px-2.5 py-0.5 text-xs font-medium"
                                    >
                                      Idea {index + 1}
                                    </Badge>
                                  </div>
                                  <CardTitle className="text-lg font-bold text-white leading-snug">
                                    {idea.title}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 pt-0 flex flex-col flex-1 space-y-4">
                                  {idea.hook && (
                                    <div>
                                      <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                                        Hook
                                      </p>
                                      <p className="text-sm text-gray-300 leading-relaxed">
                                        {idea.hook}
                                      </p>
                                    </div>
                                  )}
                                  {idea.angle && (
                                    <div>
                                      <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                                        Your angle
                                      </p>
                                      <p className="text-sm text-gray-300 leading-relaxed">
                                        {idea.angle}
                                      </p>
                                    </div>
                                  )}
                                  {idea.why_it_works && (
                                    <div>
                                      <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                                        Why it works
                                      </p>
                                      <p className="text-sm text-gray-400 leading-relaxed">
                                        {idea.why_it_works}
                                      </p>
                                    </div>
                                  )}
                                  {idea.inspired_by.length > 0 && (
                                    <div className="pt-2 border-t border-white/5 mt-auto">
                                      <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
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
                                                  className="text-xs text-blue-300 hover:text-blue-200 transition-colors inline-flex items-start gap-1.5"
                                                >
                                                  <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                                  <span>{label}</span>
                                                </a>
                                              </li>
                                            );
                                          }
                                          return (
                                            <li key={key} className="text-xs text-gray-400">
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
                          </div>
                        )}

                        {!ideasLoading && !ideasError && ideas.length === 0 && (
                          <p className="text-sm text-gray-500">
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

      <footer className="border-t border-white/5 mt-32">
        <div className="container mx-auto px-6 py-12">
          <div className="text-center text-sm text-gray-500">
            <p className="mb-2">Built for creators who want to improve</p>
            <p className="text-gray-600">Powered by Gemma 4 &amp; YouTube Data API</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
