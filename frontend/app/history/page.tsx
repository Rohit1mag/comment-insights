"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Clock,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  Search,
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

// Recharts is ~135KB gzipped and only renders in the detail view.
const AnalysisResults = dynamic(() => import("@/components/AnalysisResults"), {
  ssr: false,
});

const PAGE_SIZE = 20;

interface Sentiment {
  positive: number;
  neutral: number;
  negative: number;
}

interface HistoryItem {
  id: string;
  video_id: string;
  video_title?: string | null;
  video_url?: string | null;
  total_comments?: number | null;
  sentiment: Sentiment;
  created_at: string;
}

interface HistoryDetail extends HistoryItem {
  summary: string;
  action_items: Array<{
    title: string;
    description: string;
    impact: string;
  }>;
}

interface HistoryPage {
  items: HistoryItem[];
  next_cursor: string | null;
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

function SentimentIndicator({ sentiment }: { sentiment: Sentiment }) {
  const positive = sentiment?.positive || 0;
  const neutral = sentiment?.neutral || 0;
  const negative = sentiment?.negative || 0;
  const total = positive + neutral + negative;
  if (total === 0) return null;

  const pct = (value: number) => `${(value / total) * 100}%`;

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-2 w-28 overflow-hidden rounded-full bg-white/5">
        <div style={{ width: pct(positive) }} className="bg-blue-500" />
        <div style={{ width: pct(neutral) }} className="bg-purple-500" />
        <div style={{ width: pct(negative) }} className="bg-pink-500" />
      </div>
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="text-blue-300">{positive}</span>
        <span className="text-purple-300">{neutral}</span>
        <span className="text-pink-300">{negative}</span>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { isSignedIn, isLoaded: authLoaded } = useUser();
  const { getToken } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoryDetail | null>(null);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    async (before: string | null): Promise<HistoryPage> => {
      const token = await getToken();
      if (!token) throw new Error("Sign in required");

      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) params.set("before", before);

      const response = await fetch(`${getApiUrl()}/history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to load history"));
      }
      return response.json();
    },
    [getToken]
  );

  useEffect(() => {
    if (!authLoaded) return;

    if (!isSignedIn) {
      setItems([]);
      setNextCursor(null);
      setSelected(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    fetchPage(null)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items || []);
        setNextCursor(page.next_cursor ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoaded, isSignedIn, fetchPage]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await fetchPage(nextCursor);
      setItems((prev) => [...prev, ...(page.items || [])]);
      setNextCursor(page.next_cursor ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleOpen = async (id: string) => {
    setDetailLoadingId(id);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in required");

      const response = await fetch(`${getApiUrl()}/history/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (response.status === 404) {
        throw new Error("That analysis is no longer available.");
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to load analysis"));
      }
      setSelected(await response.json());
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load analysis");
    } finally {
      setDetailLoadingId(null);
    }
  };

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
                History
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
                  href="/ideas"
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:text-white transition-all cursor-pointer rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5"
                >
                  <Lightbulb className="h-4 w-4" />
                  <span className="hidden sm:inline">Ideas</span>
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
        {selected ? (
          <AnalysisResults
            data={{
              video_id: selected.video_id,
              video_title: selected.video_title || "",
              total_comments: selected.total_comments || 0,
              summary: selected.summary,
              sentiment: selected.sentiment,
              action_items: selected.action_items || [],
            }}
            isStreaming={false}
            summaryStreaming={false}
            backLabel="Back to History"
            onNewAnalysis={() => setSelected(null)}
          />
        ) : (
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
                Your History
              </h2>
              <p className="text-gray-400 text-lg">
                Every video you&apos;ve analyzed, newest first.
              </p>
            </div>

            {error && (
              <div className="border border-red-400/30 bg-red-500/10 p-4 mb-6 rounded-2xl backdrop-blur-xl">
                <p className="text-sm text-red-300 font-medium">{error}</p>
              </div>
            )}

            <SignedOut>
              <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-2">
                <CardHeader className="p-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-6">
                    <History className="h-8 w-8 text-blue-400" />
                  </div>
                  <CardTitle className="text-2xl mb-3 font-bold">
                    Sign in to see your history
                  </CardTitle>
                  <CardDescription className="text-gray-400 leading-relaxed">
                    Past analyses are saved to your account so you can revisit them anytime.
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
              {loading ? (
                <div className="flex items-center justify-center gap-3 text-gray-400 py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                  <span>Loading your history…</span>
                </div>
              ) : items.length === 0 ? (
                <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-2">
                  <CardHeader className="p-8">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6">
                      <MessageSquare className="h-8 w-8 text-cyan-400" />
                    </div>
                    <CardTitle className="text-2xl mb-3 font-bold">No analyses yet</CardTitle>
                    <CardDescription className="text-gray-400 leading-relaxed">
                      Analyze a YouTube video and it will show up here automatically.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-8 pt-0">
                    <Link
                      href="/"
                      className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-400 hover:to-purple-400 transition-all cursor-pointer rounded-xl shadow-lg shadow-blue-500/25"
                    >
                      <Search className="h-4 w-4" />
                      Run your first analysis
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="space-y-4 animate-in-2">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleOpen(item.id)}
                        disabled={detailLoadingId !== null}
                        className="w-full text-left glass border border-white/10 hover:border-blue-400/30 hover:bg-white/5 transition-all duration-300 rounded-2xl p-6 disabled:opacity-60 disabled:cursor-wait cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-white text-lg truncate">
                              {item.video_title || item.video_id}
                            </p>
                            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-400">
                              <span className="flex items-center gap-1.5">
                                <MessageSquare className="h-4 w-4 text-blue-400" />
                                {item.total_comments ?? 0} comments
                              </span>
                              <span className="flex items-center gap-1.5">
                                <Clock className="h-4 w-4 text-purple-400" />
                                {formatRelative(item.created_at)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="hidden sm:block">
                              <SentimentIndicator sentiment={item.sentiment} />
                            </div>
                            {detailLoadingId === item.id && (
                              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {nextCursor && (
                    <div className="flex justify-center mt-8">
                      <Button
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 hover:text-white transition-all duration-300 rounded-xl px-6 py-2.5"
                      >
                        {loadingMore ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading
                          </>
                        ) : (
                          <>
                            <ArrowLeft className="mr-2 h-4 w-4 -rotate-90" />
                            Load more
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </SignedIn>
          </div>
        )}
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
