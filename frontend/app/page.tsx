"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, MessageSquare, CheckCircle2, Loader2, Youtube, Sparkles, Zap } from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import AnalysisResults from "@/components/AnalysisResults";
import { getApiUrl } from "@/lib/api";

interface UsageData {
  used: number;
  remaining: number;
  limit: number;
  is_unlimited: boolean;
  tier: string;
  guest?: boolean;
}

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

    // SSE events are separated by blank lines
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
    <div className="border border-amber-400/30 bg-amber-500/10 p-5 mb-6 max-w-2xl mx-auto rounded-2xl backdrop-blur-xl text-left">
      <p className="text-sm text-amber-100 font-medium mb-3">
        {message ||
          "You've used your free guest analysis. Sign up to get 5 analyses per month."}
      </p>
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
    </div>
  );
}

export default function Home() {
  const { user, isSignedIn } = useUser();
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

  // Get the user's primary email
  const userEmail = user?.primaryEmailAddress?.emailAddress;

  // Fetch usage (signed-in account or guest trial) + merge guest on sign-in
  useEffect(() => {
    let cancelled = false;

    const fetchUsage = async () => {
      const apiUrl = getApiUrl();

      try {
        if (isSignedIn && userEmail) {
          // Merge guest trial into account once per session/email
          if (claimedGuestRef.current !== userEmail) {
            claimedGuestRef.current = userEmail;
            try {
              await fetch(`${apiUrl}/guest/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ email: userEmail }),
              });
            } catch (err) {
              console.error("Failed to claim guest usage:", err);
            }
          }

          const response = await fetch(
            `${apiUrl}/usage/${encodeURIComponent(userEmail)}`,
            { credentials: "include" }
          );
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
  }, [isSignedIn, userEmail]);

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

      let response: Response;
      try {
        response = await fetch(`${apiUrl}/analyze/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            video_url: videoUrl,
            user_email: isSignedIn ? userEmail : null,
          }),
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
    <div className="min-h-screen relative z-10">
      {/* Header */}
      <header className="glass sticky top-0 z-50 border-b border-white/10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 animate-in-1">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500 blur-xl opacity-30 rounded-full"></div>
                <Youtube className="h-9 w-9 text-blue-400 relative z-10" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="gradient-text" style={{ 
                  backgroundImage: 'linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%))',
                  backgroundSize: '200% 200%',
                  animation: 'gradient-shift 3s ease infinite'
                }}>
                  Disstill
                </span>
              </h1>
              <Badge variant="secondary" className="hidden sm:inline-flex bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-3 text-xs font-medium">
                Beta
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <SignedOut>
                {usage ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-400/30">
                    <Sparkles className="h-4 w-4 text-blue-400" />
                    <span className="text-blue-300">
                      {usage.remaining > 0 ? (
                        <>
                          <span className="font-bold">1</span>
                          <span className="text-gray-500 ml-1">free analysis</span>
                        </>
                      ) : (
                        <span className="text-amber-200">0 free remaining — sign up</span>
                      )}
                    </span>
                  </div>
                ) : null}
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
                {usage ? (
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    usage.is_unlimited 
                      ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-400/30' 
                      : usage.tier === 'PRO'
                      ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-400/30'
                      : 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-400/30'
                  }`}>
                    {usage.is_unlimited ? (
                      <>
                        <Zap className="h-4 w-4 text-purple-400" />
                        <span className="text-purple-300">Unlimited</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className={`h-4 w-4 ${
                          usage.tier === 'PRO' ? 'text-amber-400' : 'text-blue-400'
                        }`} />
                        <span className={usage.tier === 'PRO' ? 'text-amber-300' : 'text-blue-300'}>
                          <span className="font-bold">{usage.remaining}</span>
                          <span className="text-gray-500 mx-1">/</span>
                          <span className="text-gray-500">{usage.limit}</span>
                          {usage.tier === 'PRO' && (
                            <span className="ml-1.5 text-xs text-amber-400/70">Pro</span>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">Loading...</div>
                )}
                <UserButton 
                  appearance={{
                    elements: {
                      avatarBox: "w-9 h-9 ring-2 ring-blue-400/40 ring-offset-2 ring-offset-[#0a0f1a]"
                    }
                  }}
                />
              </SignedIn>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        {!analysisData ? (
          <>
            {/* Hero Section */}
            <div className="max-w-4xl mx-auto text-center mb-16">
              <Badge className="mb-8 animate-in-1 bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-4 py-1.5 text-sm font-medium" variant="secondary">
                AI-Powered Analysis
              </Badge>
              <h2 className="text-6xl md:text-7xl font-bold mb-6 animate-in-2 leading-tight">
                <span className="block gradient-text" style={{ 
                  backgroundImage: 'linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%), hsl(185 80% 55%))',
                  backgroundSize: '200% 200%',
                  animation: 'gradient-shift 5s ease infinite'
                }}>
                  Transform Comments
                </span>
                <span className="block text-gray-300 mt-3">
                  Into Insights
                </span>
              </h2>
              <p className="text-xl text-gray-400 mb-12 animate-in-3 max-w-2xl mx-auto leading-relaxed">
                Get actionable feedback from YouTube comments.
                Understand sentiment, discover patterns, and improve your content.
              </p>

              {/* Input Section */}
              <div className="flex gap-3 max-w-3xl mx-auto mb-8 animate-in-4">
                <Input
                  type="text"
                  placeholder="Paste YouTube video URL..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  className="h-14 text-base bg-white/5 border border-white/10 focus:border-blue-400/50 text-white placeholder:text-gray-500 rounded-2xl transition-all duration-300 hover:bg-white/8 focus:bg-white/8 shadow-lg"
                  disabled={loading}
                />
                <Button
                  onClick={handleAnalyze}
                  disabled={loading}
                  size="lg"
                  className="px-10 h-14 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white font-semibold text-base rounded-2xl transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-5 w-5" />
                      Analyze
                    </>
                  )}
                </Button>
              </div>

              {error && (
                <div className="border border-red-400/30 bg-red-500/10 p-4 mb-6 max-w-2xl mx-auto rounded-2xl backdrop-blur-xl">
                  <p className="text-sm text-red-300 font-medium">
                    {error}
                  </p>
                </div>
              )}

              {showGuestSignupCta && !isSignedIn && (
                <GuestSignupCta
                  message={
                    usage && usage.remaining <= 0
                      ? "You've used your free guest analysis. Sign up to get 5 analyses per month."
                      : undefined
                  }
                />
              )}

              {loading && (
                <div className="border border-blue-400/30 bg-blue-500/10 p-4 mb-6 max-w-2xl mx-auto rounded-2xl backdrop-blur-xl">
                  <div className="text-sm text-blue-300 flex items-center gap-3 font-medium">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{loadingStep || "Processing..."}</span>
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-500">
                {isSignedIn
                  ? "Analysis typically takes 15-30 seconds • Works with any public YouTube video"
                  : usage && usage.remaining <= 0
                  ? "Free guest analysis used — sign up for 5 analyses/month"
                  : "Try 1 free analysis — no account needed • Sign up for 5/month"}
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto mb-20">
              <Card className="glass border-white/10 hover:border-blue-400/30 hover:bg-white/5 transition-all duration-300 animate-in-2 group rounded-3xl overflow-hidden">
                <CardHeader className="p-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <TrendingUp className="h-8 w-8 text-blue-400" />
                  </div>
                  <CardTitle className="text-xl mb-3 font-bold">
                    Sentiment Analysis
                  </CardTitle>
                  <CardDescription className="text-gray-400 leading-relaxed">
                    Understand the overall mood of your audience with detailed sentiment breakdowns and insights
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="glass border-white/10 hover:border-purple-400/30 hover:bg-white/5 transition-all duration-300 animate-in-3 group rounded-3xl overflow-hidden">
                <CardHeader className="p-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <CheckCircle2 className="h-8 w-8 text-purple-400" />
                  </div>
                  <CardTitle className="text-xl mb-3 font-bold">
                    Action Items
                  </CardTitle>
                  <CardDescription className="text-gray-400 leading-relaxed">
                    Get specific, prioritized recommendations on what to improve in your content
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="glass border-white/10 hover:border-cyan-400/30 hover:bg-white/5 transition-all duration-300 animate-in-4 group rounded-3xl overflow-hidden">
                <CardHeader className="p-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <MessageSquare className="h-8 w-8 text-cyan-400" />
                  </div>
                  <CardTitle className="text-xl mb-3 font-bold">
                    Clear Summaries
                  </CardTitle>
                  <CardDescription className="text-gray-400 leading-relaxed">
                    Get a concise read on overall sentiment and the feedback that actually matters
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            {/* Example Section */}
            <div className="max-w-5xl mx-auto animate-in-5">
              <Card className="glass border-white/10 rounded-3xl overflow-hidden">
                <CardHeader className="p-8 border-b border-white/5">
                  <CardTitle className="text-2xl mb-2 font-bold">
                    See it in action
                  </CardTitle>
                  <CardDescription className="text-gray-400 text-base">
                    Example insights from a typical video analysis
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8">
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-blue-400/30 hover:bg-white/8 transition-all duration-300">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-white mb-1">
                          Improve audio quality
                        </p>
                        <p className="text-sm text-gray-400 leading-relaxed">
                          Multiple viewers mentioned background noise. Consider using a better microphone or noise reduction software.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4 p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-purple-400/30 hover:bg-white/8 transition-all duration-300">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-purple-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-white mb-1">
                          Add timestamps
                        </p>
                        <p className="text-sm text-gray-400 leading-relaxed">
                          Viewers want to jump to specific sections. Add chapter markers to improve navigation.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4 p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-cyan-400/30 hover:bg-white/8 transition-all duration-300">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-white mb-1">
                          Slow down explanations
                        </p>
                        <p className="text-sm text-gray-400 leading-relaxed">
                          Beginners found the pace too fast. Consider adding more pauses and breaking down complex topics.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

          </>
        ) : (
          <>
            {showGuestSignupCta && isGuest && !isStreaming && (
              <div className="max-w-4xl mx-auto mb-6">
                <GuestSignupCta message="Enjoying the insights? Sign up to keep analyzing — free accounts get 5 analyses/month." />
              </div>
            )}
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

      {/* Credit Used Notification Toast */}
      {creditUsedNotification && usage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-5 fade-in duration-300">
          <div className="glass px-6 py-4 flex items-center gap-3 rounded-2xl border border-blue-400/30 shadow-lg shadow-blue-500/20">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500/20 to-purple-500/20">
              <Sparkles className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-300">
                {isGuest ? "Free analysis used" : "1 credit used"}
              </p>
              <p className="text-xs text-gray-400">
                {isGuest
                  ? usage.remaining > 0
                    ? `${usage.remaining} free analysis remaining`
                    : "Sign up for more analyses"
                  : `${usage.remaining} analysis credit${usage.remaining !== 1 ? "s" : ""} remaining`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 mt-32">
        <div className="container mx-auto px-6 py-12">
          <div className="text-center text-sm text-gray-500">
            <p className="mb-2">Built for creators who want to improve</p>
            <p className="text-gray-600">Powered by Gemma 4 & YouTube Data API</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
