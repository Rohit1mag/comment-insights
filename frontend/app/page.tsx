"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, MessageSquare, CheckCircle2, Loader2, Youtube } from "lucide-react";
import AnalysisResults from "@/components/AnalysisResults";

export default function Home() {
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");

  const handleAnalyze = async () => {
    if (!videoUrl) {
      setError("Please enter a YouTube URL");
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
            body: JSON.stringify({ video_url: videoUrl }),
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
            </div>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Beta
            </Badge>
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
                Try it with any public YouTube video. Analysis takes 15-30 seconds.
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
          <AnalysisResults data={analysisData} onNewAnalysis={() => setAnalysisData(null)} />
        )}
      </main>

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
