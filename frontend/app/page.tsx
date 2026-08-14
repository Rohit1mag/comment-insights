"use client";

import { useState, useEffect, useRef } from "react";
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
  Youtube,
  Sparkles,
} from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { getApiUrl } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { StatusBanner } from "@/components/StatusBanner";
import type { UsageData } from "@/components/UsageChip";

const AnalysisResults = dynamic(() => import("@/components/AnalysisResults"), {
  ssr: false,
});

interface AnalysisData {
  video_id?: string;
  video_title?: string;
  total_comments?: number;
  summary: string;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
  action_items: Array<{
    title: string;
    description: string;
    impact: string;
  }>;
}

async function consumeSse(
  response: Response,
  handlers: Record<string, (data: any) => void>
) {
  if (!response.body) {
    throw new Error("No response body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) continue;
      const dataStr = dataLines.join("\n");
      let parsed: any = dataStr;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        /* keep raw string */
      }
      const handler = handlers[eventName];
      if (handler) handler(parsed);
    }
  }
}

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
        "You've used your free guest analysis. Sign up to get 5 free analyses a month."}
    </StatusBanner>
  );
}

const EXAMPLES = [
  {
    title: "Improve audio quality",
    body: "Multiple viewers mentioned background noise. Consider using a better microphone or noise reduction software.",
    iconClass: "from-blue-500/20 to-cyan-500/20",
    iconColor: "text-blue-400",
  },
  {
    title: "Add timestamps",
    body: "Viewers want to jump to specific sections. Add chapter markers to improve navigation.",
    iconClass: "from-violet-500/20 to-fuchsia-500/20",
    iconColor: "text-violet-400",
  },
  {
    title: "Slow down explanations",
    body: "Beginners found the pace too fast. Consider adding more pauses and breaking down complex topics.",
    iconClass: "from-cyan-500/20 to-blue-500/20",
    iconColor: "text-cyan-400",
  },
];

export default function Home() {
  const { user, isSignedIn, isLoaded: authLoaded } = useUser();
  const { getToken } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
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

  const handleAnalyze = async () => {
    if (!videoUrl) {
      setError("Please enter a YouTube URL");
      return;
    }

    if (!isSignedIn && usage && usage.remaining <= 0) {
      setError("You've used your free guest analysis. Sign up to continue.");
      setShowGuestSignupCta(true);
      return;
    }

    if (isSignedIn && usage && !usage.is_unlimited && usage.remaining <= 0) {
      setError(
        `You've reached your ${usage.tier} tier limit of ${usage.limit} analyses. Upgrade to Pro for 15 analyses/month!`
      );
      return;
    }

    setError("");
    setShowGuestSignupCta(false);
    setLoading(true);
    setAnalysisData(null);
    setIsStreaming(false);
    setSummaryStreaming(false);

    try {
      const apiUrl = getApiUrl();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      setLoadingStep("Fetching comments from YouTube…");

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
          setLoading(false);
          setIsStreaming(true);
          setSummaryStreaming(true);
          setLoadingStep("Generating insights…");
          const sentiment = meta?.sentiment || {
            positive: 0,
            neutral: 0,
            negative: 0,
          };
          setAnalysisData({
            ...meta,
            summary: "",
            sentiment,
            action_items: [],
          });
        },
        sentiment: (sentiment) => {
          setAnalysisData((prev) =>
            prev
              ? { ...prev, sentiment }
              : {
                  summary: "",
                  sentiment,
                  action_items: [],
                }
          );
        },
        summary_delta: (payload) => {
          const text = payload?.text ?? "";
          if (!text) return;
          setAnalysisData((prev) =>
            prev
              ? { ...prev, summary: (prev.summary || "") + text }
              : { summary: text, sentiment: { positive: 0, neutral: 0, negative: 0 }, action_items: [] }
          );
        },
        summary: (payload) => {
          const text = payload?.text ?? "";
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
          setAnalysisData((prev) =>
            prev
              ? { ...prev, action_items: Array.isArray(items) ? items : [] }
              : {
                  summary: "",
                  sentiment: { positive: 0, neutral: 0, negative: 0 },
                  action_items: Array.isArray(items) ? items : [],
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
          streamError = payload?.detail || "Analysis failed";
        },
      });

      if (streamError) {
        if (/sign up|sign in|guest/i.test(streamError)) {
          setShowGuestSignupCta(true);
        }
        throw new Error(streamError);
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Request timed out. Please try again.");
      } else {
        setError(err.message || "Something went wrong. Please try again.");
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
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {!analysisData ? (
          <>
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <Badge className="mb-6 animate-in-1 px-3 py-1">AI-Powered Analysis</Badge>
              <h2 className="mb-5 animate-in-2 text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
                <span className="gradient-text block">Transform comments</span>
                <span className="mt-2 block text-white/85">into insights</span>
              </h2>
              <p className="mx-auto mb-10 max-w-xl animate-in-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
                Get actionable feedback from YouTube comments. Understand sentiment,
                discover patterns, and improve your content.
              </p>

              <div className="mx-auto mb-5 flex max-w-2xl animate-in-4 flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex h-12 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 transition-colors focus-within:border-blue-400/40 focus-within:ring-2 focus-within:ring-blue-400/20 hover:bg-white/[0.06]">
                  <Youtube className="h-5 w-5 shrink-0 text-white/35" />
                  <input
                    type="text"
                    placeholder="Paste a YouTube video URL"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                    className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                    disabled={loading}
                    aria-label="YouTube video URL"
                  />
                </label>
                <Button
                  onClick={handleAnalyze}
                  disabled={loading}
                  size="lg"
                  className="h-12 px-7"
                >
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
              </div>

              {error ? (
                <StatusBanner variant="error" className="mx-auto mb-5 max-w-2xl text-left">
                  {error}
                </StatusBanner>
              ) : null}

              {showGuestSignupCta && !isSignedIn ? (
                <GuestSignupCta
                  message={
                    usage && usage.remaining <= 0
                      ? "You've used your free guest analysis. Sign up to get 5 free analyses a month."
                      : undefined
                  }
                />
              ) : null}

              {loading ? (
                <StatusBanner variant="info" className="mx-auto mb-5 max-w-2xl">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span>{loadingStep || "Processing..."}</span>
                </StatusBanner>
              ) : null}

              <p className="text-sm text-white/40">
                {isSignedIn
                  ? "Typically 15–30 seconds · works with any public YouTube video"
                  : usage && usage.remaining <= 0
                    ? "Free guest analysis used — sign up for 5 free analyses a month"
                    : "Try 1 free analysis — no account needed"}
              </p>
            </div>

            <div className="mb-16 grid gap-4 md:grid-cols-3">
              <Card className="animate-in-2 group transition-colors hover:border-blue-400/25 hover:bg-white/[0.05]">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                    <TrendingUp className="h-5 w-5 text-blue-400" />
                  </div>
                  <CardTitle className="mb-2">Sentiment analysis</CardTitle>
                  <CardDescription>
                    Understand the overall mood of your audience with a clear
                    breakdown of positive, neutral, and negative comments.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="animate-in-3 group transition-colors hover:border-violet-400/25 hover:bg-white/[0.05]">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
                    <CheckCircle2 className="h-5 w-5 text-violet-400" />
                  </div>
                  <CardTitle className="mb-2">Action items</CardTitle>
                  <CardDescription>
                    Get specific, prioritized recommendations on what to improve
                    in your next video.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="animate-in-4 group transition-colors hover:border-cyan-400/25 hover:bg-white/[0.05]">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20">
                    <MessageSquare className="h-5 w-5 text-cyan-400" />
                  </div>
                  <CardTitle className="mb-2">Clear summaries</CardTitle>
                  <CardDescription>
                    A concise read on overall sentiment and the feedback that
                    actually matters.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            <Card className="animate-in-5 overflow-hidden">
              <CardHeader className="border-b border-white/[0.06]">
                <CardTitle className="text-xl">See it in action</CardTitle>
                <CardDescription>
                  Example insights from a typical video analysis
                </CardDescription>
              </CardHeader>
              <div className="space-y-2 p-4 sm:p-5">
                {EXAMPLES.map((example) => (
                  <div
                    key={example.title}
                    className="flex items-start gap-3.5 rounded-xl border border-transparent p-4 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${example.iconClass}`}
                    >
                      <CheckCircle2 className={`h-4 w-4 ${example.iconColor}`} />
                    </div>
                    <div>
                      <p className="mb-0.5 font-medium text-white">{example.title}</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {example.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        ) : (
          <>
            {showGuestSignupCta && isGuest && !isStreaming ? (
              <div className="mx-auto mb-6 max-w-4xl">
                <GuestSignupCta message="Enjoying the insights? Sign up to keep analyzing — free accounts get 5 analyses a month." />
              </div>
            ) : null}
            <AnalysisResults
              data={analysisData}
              isStreaming={isStreaming}
              summaryStreaming={summaryStreaming}
              onNewAnalysis={() => {
                setAnalysisData(null);
                setIsStreaming(false);
                setSummaryStreaming(false);
              }}
            />
          </>
        )}
      </main>

      {creditUsedNotification && usage ? (
        <div className="fixed top-20 left-1/2 z-50 -translate-x-1/2 animate-in-1">
          <div className="flex items-center gap-3 rounded-xl border border-blue-400/25 bg-[#0b1220]/90 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur-xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15">
              <Sparkles className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-200">
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
