"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  TrendingUp,
  MessageSquare,
  CheckCircle2,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { getApiUrl } from "@/lib/api";
import { consumeSse } from "@/lib/sse";
import { DEMO_ANALYSIS } from "@/lib/demo";
import type { AnalysisData } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { StatusBanner } from "@/components/StatusBanner";
import type { UsageData } from "@/components/UsageChip";

const AnalysisResults = dynamic(() => import("@/components/AnalysisResults"), {
  ssr: false,
});

function GuestSignupCta({ message }: { message?: string }) {
  return (
    <StatusBanner
      variant="warning"
      className="mx-auto mb-6 max-w-2xl text-left"
      action={
        <div className="flex flex-wrap gap-2">
          <SignInButton mode="modal">
            <Button variant="outline" size="sm">
              Sign in
            </Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button size="sm">Sign up free</Button>
          </SignUpButton>
        </div>
      }
    >
      {message ||
        "You've used your free guest analysis. Sign up for 5 free analyses a month."}
    </StatusBanner>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="mx-auto max-w-5xl animate-in-2" aria-hidden>
      <div className="mb-10 space-y-3">
        <div className="h-4 w-24 animate-pulse rounded bg-white/5" />
        <div className="h-10 w-3/4 animate-pulse rounded-lg bg-white/5" />
        <div className="h-4 w-40 animate-pulse rounded bg-white/5" />
      </div>
      <div className="mb-8 h-64 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03]" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03]" />
        <div className="h-72 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03]" />
      </div>
    </div>
  );
}

function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const demoFromUrl = searchParams.get("demo") === "1";
  const urlFromQuery = searchParams.get("url");
  const { user, isSignedIn, isLoaded: authLoaded } = useUser();
  const { getToken } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(
    demoFromUrl ? DEMO_ANALYSIS : null
  );
  const [isDemo, setIsDemo] = useState(demoFromUrl);
  const [isStreaming, setIsStreaming] = useState(false);
  const [summaryStreaming, setSummaryStreaming] = useState(false);
  const [error, setError] = useState("");
  const [showGuestSignupCta, setShowGuestSignupCta] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [creditUsedNotification, setCreditUsedNotification] = useState(false);
  const claimedGuestRef = useRef<string | null>(null);

  const userEmail = user?.primaryEmailAddress?.emailAddress;

  useEffect(() => {
    if (urlFromQuery) setVideoUrl(urlFromQuery);
  }, [urlFromQuery]);

  useEffect(() => {
    if (demoFromUrl) {
      setIsDemo(true);
      setAnalysisData(DEMO_ANALYSIS);
      setIsStreaming(false);
      setSummaryStreaming(false);
      setError("");
      return;
    }
    setIsDemo(false);
    setAnalysisData((prev) =>
      prev?.video_id === DEMO_ANALYSIS.video_id ? null : prev
    );
  }, [demoFromUrl]);

  useEffect(() => {
    if (!authLoaded) return;

    let cancelled = false;

    const fetchUsage = async () => {
      const apiUrl = getApiUrl();

      try {
        if (isSignedIn && userEmail) {
          const token = await getToken();
          if (!token) return;
          const authHeaders = { Authorization: `Bearer ${token}` };

          if (claimedGuestRef.current !== userEmail) {
            claimedGuestRef.current = userEmail;
            try {
              await fetch(`${apiUrl}/guest/claim`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
              });
            } catch (err) {
              console.error("Failed to claim guest usage:", err);
            }
          }

          const response = await fetch(`${apiUrl}/usage`, {
            headers: authHeaders,
            credentials: "include",
          });
          if (!cancelled && response.ok) {
            const data = await response.json();
            setUsage(data);
          }
        } else if (!isSignedIn) {
          claimedGuestRef.current = null;
          const response = await fetch(`${apiUrl}/guest/usage`, {
            credentials: "include",
          });
          if (!cancelled && response.ok) {
            const data = await response.json();
            setUsage(data);
            if (data.remaining <= 0) {
              setShowGuestSignupCta(true);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch usage:", err);
      }
    };

    fetchUsage();
    return () => {
      cancelled = true;
    };
  }, [authLoaded, isSignedIn, userEmail, getToken]);

  const openDemo = () => {
    setError("");
    setIsStreaming(false);
    setSummaryStreaming(false);
    router.replace("/?demo=1");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetToHome = () => {
    setIsStreaming(false);
    setSummaryStreaming(false);
    router.replace("/");
  };

  const handleAnalyze = async () => {
    if (!videoUrl) {
      setError("Paste a YouTube URL to start.");
      return;
    }

    if (!isSignedIn && usage && usage.remaining <= 0) {
      setError("You've used your free guest analysis. Sign up to continue.");
      setShowGuestSignupCta(true);
      return;
    }

    if (isSignedIn && usage && !usage.is_unlimited && usage.remaining <= 0) {
      setError(
        `You've reached your ${usage.tier} tier limit of ${usage.limit} analyses. Upgrade to Pro for 15 analyses/month.`
      );
      return;
    }

    setError("");
    setShowGuestSignupCta(false);
    setLoading(true);
    setIsDemo(false);
    setAnalysisData(null);
    setIsStreaming(false);
    setSummaryStreaming(false);
    router.replace("/");

    try {
      const apiUrl = getApiUrl();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      setLoadingStep("Pulling comments from YouTube…");

      const token = isSignedIn ? await getToken() : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(`${apiUrl}/analyze/stream`, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ video_url: videoUrl }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = "Failed to analyze";
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        if (
          response.status === 401 ||
          /sign up|sign in|guest/i.test(errorMessage)
        ) {
          setShowGuestSignupCta(true);
        }
        throw new Error(errorMessage);
      }

      let streamError: string | null = null;
      let credited = false;

      await consumeSse(response, {
        meta: (meta) => {
          const payload = (meta || {}) as Partial<AnalysisData>;
          setLoading(false);
          setIsStreaming(true);
          setSummaryStreaming(true);
          setLoadingStep("Writing the brief…");
          const sentiment = payload.sentiment || {
            positive: 0,
            neutral: 0,
            negative: 0,
          };
          setAnalysisData({
            ...payload,
            summary: "",
            sentiment,
            action_items: [],
          });
        },
        sentiment: (sentiment) => {
          const next = sentiment as AnalysisData["sentiment"];
          setAnalysisData((prev) =>
            prev
              ? { ...prev, sentiment: next }
              : {
                  summary: "",
                  sentiment: next,
                  action_items: [],
                }
          );
        },
        summary_delta: (payload) => {
          const text = (payload as { text?: string })?.text ?? "";
          if (!text) return;
          setAnalysisData((prev) =>
            prev
              ? { ...prev, summary: (prev.summary || "") + text }
              : { summary: text, sentiment: { positive: 0, neutral: 0, negative: 0 }, action_items: [] }
          );
        },
        summary: (payload) => {
          const text = (payload as { text?: string })?.text ?? "";
          setSummaryStreaming(false);
          setAnalysisData((prev) =>
            prev
              ? { ...prev, summary: text || prev.summary }
              : {
                  summary: text,
                  sentiment: { positive: 0, neutral: 0, negative: 0 },
                  action_items: [],
                }
          );
        },
        action_items: (items) => {
          const list = Array.isArray(items) ? items : [];
          setAnalysisData((prev) =>
            prev
              ? { ...prev, action_items: list }
              : {
                  summary: "",
                  sentiment: { positive: 0, neutral: 0, negative: 0 },
                  action_items: list,
                }
          );
        },
        done: () => {
          setIsStreaming(false);
          setSummaryStreaming(false);
          setLoadingStep("");
          if (!credited && usage && !usage.is_unlimited) {
            credited = true;
            const nextRemaining = Math.max(0, usage.remaining - 1);
            setUsage({
              ...usage,
              used: usage.used + 1,
              remaining: nextRemaining,
            });
            if (!isSignedIn && nextRemaining <= 0) {
              setShowGuestSignupCta(true);
            }
            setCreditUsedNotification(true);
            setTimeout(() => setCreditUsedNotification(false), 5000);
          }
        },
        error: (payload) => {
          streamError = (payload as { detail?: string })?.detail || "Analysis failed";
        },
      });

      if (streamError) {
        if (/sign up|sign in|guest/i.test(streamError)) {
          setShowGuestSignupCta(true);
        }
        throw new Error(streamError);
      }
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : "";
      if (name === "AbortError") {
        setError("Request timed out. Try again with a shorter comment section.");
      } else {
        setError(message || "Something went wrong. Please try again.");
      }
      setIsStreaming(false);
      setSummaryStreaming(false);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const isGuest = !isSignedIn;

  return (
    <AppShell usage={usage}>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {loading && !analysisData ? (
          <>
            <StatusBanner variant="info" className="mx-auto mb-8 max-w-5xl">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>{loadingStep || "Working…"}</span>
            </StatusBanner>
            <AnalysisSkeleton />
          </>
        ) : !analysisData ? (
          <>
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <Badge className="mb-6 animate-in-1 px-3 py-1">Comment intelligence</Badge>
              <h1 className="mb-5 animate-in-2 font-display text-4xl font-medium leading-[1.08] tracking-tight sm:text-6xl">
                Read every comment.
                <span className="mt-2 block text-amber-200/90">Keep the signal.</span>
              </h1>
              <p className="mx-auto mb-10 max-w-xl animate-in-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
                Disstill turns a YouTube comment section into a short brief:
                mood, patterns, and the three things to fix before you upload again.
              </p>

              <form
                className="mx-auto mb-5 flex max-w-2xl animate-in-4 flex-col gap-3 sm:flex-row sm:items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAnalyze();
                }}
              >
                <label className="flex h-12 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 transition-colors focus-within:border-amber-400/40 focus-within:ring-2 focus-within:ring-amber-400/20 hover:bg-white/[0.06]">
                  <Play className="h-4 w-4 shrink-0 text-amber-300/70" />
                  <input
                    type="text"
                    inputMode="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                    disabled={loading}
                    aria-label="YouTube video URL"
                    autoComplete="off"
                  />
                </label>
                <Button type="submit" disabled={loading} size="lg" className="h-12 px-7">
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Analyze
                    </>
                  )}
                </Button>
              </form>

              {error ? (
                <StatusBanner variant="error" className="mx-auto mb-5 max-w-2xl text-left">
                  {error}
                </StatusBanner>
              ) : null}

              {showGuestSignupCta && !isSignedIn ? (
                <GuestSignupCta
                  message={
                    usage && usage.remaining <= 0
                      ? "You've used your free guest analysis. Sign up for 5 free analyses a month."
                      : undefined
                  }
                />
              ) : null}

              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <p className="text-sm text-white/40">
                  {isSignedIn
                    ? "Usually 15–30 seconds · any public video"
                    : usage && usage.remaining <= 0
                      ? "Free guest analysis used — sign up for five a month"
                      : "One free analysis · no account"}
                </p>
                <span className="hidden text-white/20 sm:inline">·</span>
                <button
                  type="button"
                  onClick={openDemo}
                  className="text-sm font-medium text-amber-200/80 transition-colors hover:text-amber-100"
                >
                  View a sample report
                </button>
              </div>
            </div>

            <ol className="mb-16 grid gap-4 md:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Paste a URL",
                  body: "Any public YouTube video. We pull up to a thousand comments — the ones people actually wrote, not a summary of the transcript.",
                  motion: "animate-in-2",
                },
                {
                  step: "02",
                  title: "Read the room",
                  body: "Sentiment is scored, then a brief is written like a producer note: what landed, what stalled, and what they asked for.",
                  motion: "animate-in-3",
                },
                {
                  step: "03",
                  title: "Ship the fix",
                  body: "Three to five actions, ranked by impact. Export a PDF if you want it in the next standup.",
                  motion: "animate-in-4",
                },
              ].map((item) => (
                <li
                  key={item.step}
                  className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-left ${item.motion}`}
                >
                  <p className="mb-3 font-mono text-xs tracking-widest text-amber-300/70">
                    {item.step}
                  </p>
                  <h2 className="mb-2 font-display text-2xl font-medium">{item.title}</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ol>

            <div className="mb-16 grid gap-4 md:grid-cols-3">
              <Card className="animate-in-2 group transition-colors hover:border-amber-400/25 hover:bg-white/[0.05]">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                    <TrendingUp className="h-5 w-5 text-amber-300" />
                  </div>
                  <CardTitle className="mb-2 font-sans text-lg">Sentiment, scored</CardTitle>
                  <CardDescription>
                    Positive, neutral, and negative — counted from the comments, not guessed from the title.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="animate-in-3 group transition-colors hover:border-amber-400/25 hover:bg-white/[0.05]">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                    <CheckCircle2 className="h-5 w-5 text-amber-300" />
                  </div>
                  <CardTitle className="mb-2 font-sans text-lg">What to fix next</CardTitle>
                  <CardDescription>
                    Specific recommendations, ranked. Audio, pacing, chapters, the question you keep getting asked.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="animate-in-4 group transition-colors hover:border-amber-400/25 hover:bg-white/[0.05]">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                    <MessageSquare className="h-5 w-5 text-amber-300" />
                  </div>
                  <CardTitle className="mb-2 font-sans text-lg">A brief you can read</CardTitle>
                  <CardDescription>
                    Not a wall of quotes. A short read on mood, the feedback that repeated, and the follow-up people want.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            <Card className="animate-in-5 overflow-hidden">
              <CardHeader className="border-b border-white/[0.06] sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="font-sans text-lg">See a finished brief</CardTitle>
                  <CardDescription>
                    A sample report from a studio-gear video — the same layout you get on a live run.
                  </CardDescription>
                </div>
                <Button onClick={openDemo} variant="outline" className="mt-4 sm:mt-0">
                  Open sample
                </Button>
              </CardHeader>
              <div className="space-y-2 p-4 sm:p-5">
                {DEMO_ANALYSIS.action_items.slice(0, 3).map((item, index) => (
                  <div
                    key={item.title}
                    className="flex items-start gap-3.5 rounded-xl border border-transparent p-4 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-sm text-amber-200">
                      {index + 1}
                    </div>
                    <div>
                      <p className="mb-0.5 font-medium text-white">{item.title}</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        ) : (
          <>
            {showGuestSignupCta && isGuest && !isStreaming && !isDemo ? (
              <div className="mx-auto mb-6 max-w-4xl">
                <GuestSignupCta message="Keep going — free accounts get 5 analyses a month." />
              </div>
            ) : null}
            <AnalysisResults
              data={analysisData}
              isStreaming={isStreaming}
              summaryStreaming={summaryStreaming}
              isDemo={isDemo}
              onNewAnalysis={resetToHome}
            />
          </>
        )}
      </main>

      {creditUsedNotification && usage ? (
        <div className="fixed top-20 left-1/2 z-50 -translate-x-1/2 animate-in-1">
          <div className="flex items-center gap-3 rounded-xl border border-amber-400/25 bg-[#16120e]/90 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur-xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
              <Sparkles className="h-4 w-4 text-amber-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-100">
                {isGuest ? "Free analysis used" : "1 credit used"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isGuest
                  ? usage.remaining > 0
                    ? `${usage.remaining} free analysis remaining`
                    : "Sign up for more analyses"
                  : `${usage.remaining} analysis credit${usage.remaining !== 1 ? "s" : ""} remaining`}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14" />
        </AppShell>
      }
    >
      <HomePage />
    </Suspense>
  );
}
