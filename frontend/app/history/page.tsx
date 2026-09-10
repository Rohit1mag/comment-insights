"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Loader2,
  MessageSquare,
  Search,
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
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { StatusBanner } from "@/components/StatusBanner";

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
      <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
        <div style={{ width: pct(positive) }} className="bg-[#6f9e6a]" />
        <div style={{ width: pct(neutral) }} className="bg-[#c4a574]" />
        <div style={{ width: pct(negative) }} className="bg-[#c45c4a]" />
      </div>
      <div className="hidden items-center gap-2 text-xs font-medium tabular-nums lg:flex">
        <span className="text-[#8fba88]">{positive}</span>
        <span className="text-[#c4a574]">{neutral}</span>
        <span className="text-[#d37a6a]">{negative}</span>
      </div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
      ))}
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
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
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
          <div className="mx-auto max-w-3xl">
            <PageHeader
              title="History"
              description="Every video you've analyzed — newest first. Open one to reread the brief."
            />

            {error ? (
              <StatusBanner variant="error" className="mb-6">
                {error}
              </StatusBanner>
            ) : null}

            <SignedOut>
              <Card className="animate-in-2">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                    <History className="h-5 w-5 text-amber-300" />
                  </div>
                  <CardTitle className="mb-2 font-display text-2xl font-medium">
                    Sign in to see your history
                  </CardTitle>
                  <CardDescription>
                    Signed-in runs are saved to your account so you can reopen the brief later.
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
              {loading ? (
                <HistorySkeleton />
              ) : items.length === 0 ? (
                <Card className="animate-in-2">
                  <CardHeader>
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                      <MessageSquare className="h-5 w-5 text-amber-300" />
                    </div>
                    <CardTitle className="mb-2 font-display text-2xl font-medium">
                      No analyses yet
                    </CardTitle>
                    <CardDescription>
                      Run a video through Disstill and it lands here automatically.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Link
                      href="/"
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-amber-400 px-4 text-sm font-semibold text-stone-950 shadow-lg shadow-amber-900/20 hover:bg-amber-300"
                    >
                      <Search className="mr-2 h-4 w-4" />
                      Run your first analysis
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="space-y-2 animate-in-2">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleOpen(item.id)}
                        disabled={detailLoadingId !== null}
                        className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition-colors hover:border-amber-400/25 hover:bg-white/[0.05] disabled:cursor-wait disabled:opacity-60 sm:p-5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-white">
                            {item.video_title || item.video_id}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-amber-300" />
                              {item.total_comments ?? 0} comments
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-white/40" />
                              {formatRelative(item.created_at)}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="hidden sm:block">
                            <SentimentIndicator sentiment={item.sentiment} />
                          </div>
                          {detailLoadingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-white/25 transition-colors group-hover:text-white/60" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {nextCursor ? (
                    <div className="mt-8 flex justify-center">
                      <Button
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        variant="outline"
                      >
                        {loadingMore ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading
                          </>
                        ) : (
                          <>
                            <ChevronDown className="mr-2 h-4 w-4" />
                            Load more
                          </>
                        )}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </SignedIn>
          </div>
        )}
      </main>
    </AppShell>
  );
}
