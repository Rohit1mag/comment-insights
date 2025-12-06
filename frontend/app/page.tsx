"use client";

import { useState, useEffect } from "react";
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

interface UsageData {
  used: number;
  remaining: number;
  limit: number;
  is_unlimited: boolean;
}

export default function Home() {
  const { user, isSignedIn } = useUser();
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [creditUsedNotification, setCreditUsedNotification] = useState(false);

  // Get the user's primary email
  const userEmail = user?.primaryEmailAddress?.emailAddress;

  // Fetch usage data when user signs in
  useEffect(() => {
    const fetchUsage = async () => {
      if (!userEmail) {
        setUsage(null);
        return;
      }

      console.log("Fetching usage for:", userEmail);

      try {
        const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const apiUrl = envApiUrl || (isDev ? 'http://localhost:8000' : '/api/python');
        
        console.log("API URL:", `${apiUrl}/usage/${encodeURIComponent(userEmail)}`);
        
        const response = await fetch(`${apiUrl}/usage/${encodeURIComponent(userEmail)}`);
        if (response.ok) {
          const data = await response.json();
          console.log("Usage data received:", data);
          setUsage(data);
        } else {
          console.error("Failed to fetch usage, status:", response.status);
        }
      } catch (err) {
        console.error("Failed to fetch usage:", err);
      }
    };

    fetchUsage();
  }, [userEmail]);

  const handleAnalyze = async () => {
    if (!videoUrl) {
      setError("Please enter a YouTube URL");
      return;
    }

    if (!isSignedIn || !userEmail) {
      setError("Please sign in to analyze videos");
      return;
    }

    // Check usage limit before making request
    if (usage && !usage.is_unlimited && usage.remaining <= 0) {
      setError(`You've reached your limit of ${usage.limit} free analyses.`);
      return;
    }

    setError("");
    setLoading(true);
    setLoadingStep("Extracting video ID...");

    try {
      // Call our Python API
      setLoadingStep("Fetching all comments from YouTube... (this may take a minute for videos with many comments)");
      
      // Use environment variable if set, otherwise detect dev/prod
      const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = envApiUrl || (isDev ? 'http://localhost:8000' : '/api/python');
      
      // Create abort controller for timeout (5 minutes for videos with many comments)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes
      
      let response;
      try {
        response = await fetch(`${apiUrl}/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            video_url: videoUrl,
            user_email: userEmail 
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        // Read response as text first (can only read body once)
        const errorText = await response.text();
        let errorMessage = "Failed to analyze video";
        
        // Try to parse as JSON
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          // If not JSON, use the text as-is
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      setLoadingStep("Analyzing with AI...");
      const data = await response.json();
      setAnalysisData(data);

      // Update usage count after successful analysis
      if (usage && !usage.is_unlimited) {
        setUsage({
          ...usage,
          used: usage.used + 1,
          remaining: usage.remaining - 1,
        });
        // Show credit used notification
        setCreditUsedNotification(true);
        setTimeout(() => setCreditUsedNotification(false), 5000);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError("Request timed out. The video may have too many comments. Try a video with fewer comments.");
      } else {
        setError(err.message || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Youtube className="h-8 w-8 text-red-600" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Comment Insights
              </h1>
              <Badge variant="secondary" className="hidden sm:inline-flex">
                Beta
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <SignedOut>
                <SignInButton>
                  <button className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton>
                  <button className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-sm hover:shadow-md cursor-pointer">
                    Get started
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                {usage ? (
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all ${
                    usage.is_unlimited 
                      ? 'bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-200' 
                      : usage.remaining <= 1 
                        ? 'bg-red-50 border border-red-200' 
                        : 'bg-slate-100'
                  }`}>
                    {usage.is_unlimited ? (
                      <>
                        <Zap className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-amber-700 font-medium">Unlimited</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className={`h-3.5 w-3.5 ${usage.remaining <= 1 ? 'text-red-500' : 'text-purple-500'}`} />
                        <span className={usage.remaining <= 1 ? 'text-red-600' : 'text-slate-600'}>
                          <span className={`font-semibold ${usage.remaining <= 1 ? 'text-red-600' : 'text-purple-600'}`}>
                            {usage.remaining}
                          </span>
                          <span className="text-slate-400">/{usage.limit} left</span>
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Loading...</div>
                )}
                <UserButton 
                  appearance={{
                    elements: {
                      avatarBox: "w-9 h-9 ring-2 ring-purple-200 ring-offset-2"
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
            <div className="max-w-3xl mx-auto text-center mb-12">
              <Badge className="mb-4" variant="secondary">
                🚀 AI-Powered Analysis
              </Badge>
              <h2 className="text-5xl font-bold mb-6 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                Turn Comments into
                <br />
                Actionable Improvements
              </h2>
              <p className="text-xl text-muted-foreground mb-8">
                Get concrete, AI-powered recommendations from your YouTube comments.
                Know exactly what to improve in your next video.
              </p>

              {/* Input Section */}
              <div className="flex gap-2 max-w-2xl mx-auto mb-4">
                <Input
                  type="text"
                  placeholder="Paste your YouTube video URL here..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  className="h-12 text-base"
                  disabled={loading}
                />
                <Button
                  onClick={handleAnalyze}
                  disabled={loading}
                  size="lg"
                  className="px-8"
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

              {error && (
                <p className="text-sm text-destructive mb-4">{error}</p>
              )}

              {loading && (
                <div className="text-sm text-muted-foreground">
                  <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                  {loadingStep || "Processing..."}
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                {isSignedIn 
                  ? "Try it with any public YouTube video. Analysis takes 15-30 seconds."
                  : "Sign in to analyze YouTube videos. Free users get 5 analyses."}
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-16">
              <Card className="border-2 hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
                    <TrendingUp className="h-6 w-6 text-blue-600" />
                  </div>
                  <CardTitle className="text-lg">Sentiment Analysis</CardTitle>
                  <CardDescription>
                    Understand the overall mood of your audience with detailed sentiment breakdowns
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center mb-4">
                    <CheckCircle2 className="h-6 w-6 text-purple-600" />
                  </div>
                  <CardTitle className="text-lg">Action Items</CardTitle>
                  <CardDescription>
                    Get specific, prioritized recommendations on what to improve in your content
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-pink-100 flex items-center justify-center mb-4">
                    <MessageSquare className="h-6 w-6 text-pink-600" />
                  </div>
                  <CardTitle className="text-lg">Smart Filtering</CardTitle>
                  <CardDescription>
                    Browse comments with intelligent filters to find what matters most
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            {/* Example Section */}
            <div className="max-w-4xl mx-auto">
              <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2">
                <CardHeader>
                  <CardTitle>See it in action</CardTitle>
                  <CardDescription>
                    Try analyzing a popular tech video to see the kind of insights you'll get
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">Improve audio quality</p>
                        <p className="text-sm text-muted-foreground">
                          Multiple viewers mentioned background noise. Consider using a better microphone.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">Add timestamps</p>
                        <p className="text-sm text-muted-foreground">
                          Viewers want to jump to specific sections. Add chapter markers.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">Slow down explanations</p>
                        <p className="text-sm text-muted-foreground">
                          Beginners found the pace too fast. Consider adding more pauses.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
        </div>
          </>
        ) : (
          <div className="space-y-4">
            {/* Credits used banner */}
            {usage && !usage.is_unlimited && (
              <div className="max-w-4xl mx-auto">
                <div className={`flex items-center justify-between px-4 py-3 rounded-lg ${
                  usage.remaining <= 1 
                    ? 'bg-red-50 border border-red-200' 
                    : 'bg-purple-50 border border-purple-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <Sparkles className={`h-4 w-4 ${usage.remaining <= 1 ? 'text-red-500' : 'text-purple-500'}`} />
                    <span className={`text-sm font-medium ${usage.remaining <= 1 ? 'text-red-700' : 'text-purple-700'}`}>
                      {usage.remaining === 0 
                        ? "You've used all your free analyses" 
                        : `${usage.remaining} analysis credit${usage.remaining !== 1 ? 's' : ''} remaining`}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {usage.used} of {usage.limit} used
                  </span>
                </div>
              </div>
            )}
            <AnalysisResults data={analysisData} onNewAnalysis={() => setAnalysisData(null)} />
          </div>
        )}
      </main>

      {/* Credit Used Notification Toast */}
      {creditUsedNotification && usage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="bg-white rounded-lg shadow-lg border border-slate-200 px-4 py-3 flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              usage.remaining <= 1 ? 'bg-red-100' : 'bg-purple-100'
            }`}>
              <Sparkles className={`h-4 w-4 ${usage.remaining <= 1 ? 'text-red-500' : 'text-purple-500'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">1 credit used</p>
              <p className={`text-xs ${usage.remaining <= 1 ? 'text-red-600' : 'text-slate-500'}`}>
                {usage.remaining} credit{usage.remaining !== 1 ? 's' : ''} remaining
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-sm text-muted-foreground">
            <p>Built for YouTube creators who want to improve their content</p>
            <p className="mt-2">Powered by Claude AI & YouTube Data API</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
