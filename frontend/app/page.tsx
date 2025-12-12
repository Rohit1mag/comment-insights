"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, MessageSquare, CheckCircle2, Loader2, Youtube, Sparkles, Zap, Check, Crown } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
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
  tier: string;
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
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Get the user's primary email
  const userEmail = user?.primaryEmailAddress?.emailAddress;

  // Initialize Stripe
  const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

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

  // Handle Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      // Refresh usage data after successful subscription
      if (userEmail) {
        setTimeout(() => {
          const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
          const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const apiUrl = envApiUrl || (isDev ? 'http://localhost:8000' : '/api/python');
          
          fetch(`${apiUrl}/usage/${encodeURIComponent(userEmail)}`)
            .then(res => res.json())
            .then(data => setUsage(data))
            .catch(console.error);
        }, 2000);
      }
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("canceled") === "true") {
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [userEmail]);

  const handleCheckout = async () => {
    if (!userEmail || !isSignedIn) {
      setError("Please sign in to subscribe");
      return;
    }

    setCheckoutLoading(true);
    setError("");

    try {
      const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = envApiUrl || (isDev ? 'http://localhost:8000' : '/api/python');

      const successUrl = `${window.location.origin}?success=true`;
      const cancelUrl = `${window.location.origin}?canceled=true`;

      const response = await fetch(`${apiUrl}/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: userEmail,
          success_url: successUrl,
          cancel_url: cancelUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to create checkout session");
      }

      const { checkout_url } = await response.json();
      
      // Redirect to Stripe Checkout
      window.location.href = checkout_url;
    } catch (err: any) {
      setError(err.message || "Failed to start checkout. Please try again.");
      setCheckoutLoading(false);
    }
  };

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
      setError(`You've reached your ${usage.tier} tier limit of ${usage.limit} analyses. Upgrade to Pro for 15 analyses/month!`);
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
                  Comment Insights
                </span>
              </h1>
              <Badge variant="secondary" className="hidden sm:inline-flex bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-3 text-xs font-medium">
                Beta
              </Badge>
            </div>
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
                Get actionable feedback from your YouTube audience. 
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
                  : "Sign in to get started • Free users get 5 analyses"}
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
                    Smart Filtering
                  </CardTitle>
                  <CardDescription className="text-gray-400 leading-relaxed">
                    Browse comments with intelligent filters to find what matters most to your audience
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

            {/* Pricing Section */}
            <div className="max-w-6xl mx-auto mt-32 animate-in-5">
              <div className="text-center mb-12">
                <Badge className="mb-6 bg-blue-500/10 text-blue-300 border-blue-400/30 rounded-full px-4 py-1.5 text-sm font-medium" variant="secondary">
                  Simple Pricing
                </Badge>
                <h2 className="text-5xl font-bold mb-4">
                  <span className="gradient-text" style={{ 
                    backgroundImage: 'linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%))',
                    backgroundSize: '200% 200%',
                    animation: 'gradient-shift 5s ease infinite'
                  }}>
                    Choose Your Plan
                  </span>
                </h2>
                <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                  Start free, upgrade when you need more analyses
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                {/* Free Tier */}
                <Card className="glass border-white/10 hover:border-blue-400/30 transition-all duration-300 rounded-3xl overflow-hidden relative">
                  <CardHeader className="p-8 border-b border-white/5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                        <Sparkles className="h-6 w-6 text-blue-400" />
                      </div>
                      <div>
                        <CardTitle className="text-2xl font-bold">Free</CardTitle>
                        <CardDescription className="text-gray-400">Get started</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-bold text-white">$0</span>
                      <span className="text-gray-500">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8">
                    <ul className="space-y-4 mb-8">
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300"><span className="font-semibold text-white">5 analyses</span> per month</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">AI-powered insights</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">Sentiment analysis</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">Action items</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">PDF reports</span>
                      </li>
                    </ul>
                    <Button 
                      className="w-full h-12 bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20 rounded-xl font-semibold transition-all"
                      disabled
                    >
                      Current Plan
                    </Button>
                  </CardContent>
                </Card>

                {/* Pro Tier */}
                <Card className="glass border-amber-400/40 hover:border-amber-400/60 transition-all duration-300 rounded-3xl overflow-hidden relative shadow-lg shadow-amber-500/10">
                  <div className="absolute top-0 right-0 bg-gradient-to-br from-amber-500 to-orange-500 text-white px-4 py-1 text-xs font-bold rounded-bl-2xl">
                    POPULAR
                  </div>
                  <CardHeader className="p-8 border-b border-white/5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                        <Crown className="h-6 w-6 text-amber-400" />
                      </div>
                      <div>
                        <CardTitle className="text-2xl font-bold">Pro</CardTitle>
                        <CardDescription className="text-amber-300/70">For serious creators</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-bold text-white">$4.99</span>
                      <span className="text-gray-500">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8">
                    <ul className="space-y-4 mb-8">
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300"><span className="font-semibold text-white">15 analyses</span> per month</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">Everything in Free</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">Priority support</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-300">Early access to features</span>
                      </li>
                    </ul>
                    <Button 
                      onClick={handleCheckout}
                      disabled={checkoutLoading || !isSignedIn}
                      className="w-full h-12 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-xl font-semibold transition-all shadow-lg shadow-amber-500/25 hover:shadow-xl hover:shadow-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {checkoutLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : !isSignedIn ? (
                        "Sign in to Subscribe"
                      ) : usage?.tier === "PRO" ? (
                        "Current Plan"
                      ) : (
                        "Subscribe Now"
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* FAQ or additional info */}
              <div className="mt-12 text-center">
                <p className="text-gray-500 text-sm">
                  Need more than 15 analyses? <a href="mailto:support@example.com" className="text-blue-400 hover:text-blue-300 underline">Contact us</a> for custom pricing
                </p>
              </div>
            </div>
          </>
        ) : (
          <AnalysisResults data={analysisData} onNewAnalysis={() => setAnalysisData(null)} />
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
                1 credit used
              </p>
              <p className="text-xs text-gray-400">
                {usage.remaining} analysis credit{usage.remaining !== 1 ? 's' : ''} remaining
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 mt-32">
        <div className="container mx-auto px-6 py-12">
          <div className="text-center text-sm text-gray-500">
            <p className="mb-2">Built for YouTube creators who want to improve</p>
            <p className="text-gray-600">Powered by Llama 4 Maverick & YouTube Data API</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
