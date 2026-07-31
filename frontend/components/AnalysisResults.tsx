"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  MessageSquare,
  Download,
  Loader2,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { useState } from "react";

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

interface AnalysisResultsProps {
  data: AnalysisData;
  onNewAnalysis: () => void;
  isStreaming?: boolean;
  summaryStreaming?: boolean;
}

const SENTIMENT_COLORS = {
  positive: "#3b82f6",
  neutral: "#a855f7",
  negative: "#ec4899",
};

export default function AnalysisResults({
  data,
  onNewAnalysis,
  isStreaming = false,
  summaryStreaming = false,
}: AnalysisResultsProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const totalCount = data.total_comments || 0;
  const title = data.video_title || "";
  const itemId = data.video_id || "";

  const chartData = [
    { name: "Positive", value: data.sentiment.positive, color: SENTIMENT_COLORS.positive },
    { name: "Neutral", value: data.sentiment.neutral, color: SENTIMENT_COLORS.neutral },
    { name: "Negative", value: data.sentiment.negative, color: SENTIMENT_COLORS.negative },
  ];

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
      const isDev =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const apiUrl = envApiUrl || (isDev ? "http://localhost:8000" : "/api/python");

      const response = await fetch(`${apiUrl}/analyze/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          video_id: itemId,
          video_title: title || `YouTube Video ${itemId}`,
          total_comments: totalCount,
          summary: data.summary,
          sentiment: data.sentiment,
          action_items: data.action_items,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = "Failed to generate PDF";
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/pdf")) {
        const errorText = await response.text();
        console.error("Unexpected response type:", contentType, errorText);
        throw new Error("Server returned non-PDF response");
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error("PDF file is empty");
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `youtube_analysis_${itemId}_${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error downloading PDF:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const summaryParagraphs = (data.summary || "")
    .split("\n\n")
    .filter((p) => p.trim());

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-12 animate-in-1">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Button
            onClick={onNewAnalysis}
            className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 hover:text-white transition-all duration-300 rounded-xl px-5 py-2.5"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Analyze Another Video
          </Button>
          <Button
            onClick={handleDownloadPDF}
            disabled={isDownloading || isStreaming || !data.summary}
            className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-white bg-gradient-to-r from-blue-500/20 to-purple-500/20 hover:from-blue-500/30 hover:to-purple-500/30 transition-all duration-300 rounded-xl px-6 py-2.5 font-medium"
          >
            <Download className="mr-2 h-4 w-4" />
            {isDownloading ? "Generating PDF..." : "Download PDF Report"}
          </Button>
        </div>
        <h2
          className="text-5xl font-bold mb-4 gradient-text"
          style={{
            backgroundImage: "linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%))",
            backgroundSize: "200% 200%",
            animation: "gradient-shift 3s ease infinite",
          }}
        >
          Analysis Results
        </h2>
        <p className="text-gray-400 text-lg">
          Analyzed {totalCount} comments from your video
          {isStreaming ? " · generating insights…" : ""}
        </p>
        {title && <p className="text-gray-300 text-base mt-2 font-medium">{title}</p>}
      </div>

      {/* Action Items */}
      <Card className="mb-12 glass border-white/10 rounded-3xl overflow-hidden animate-in-2">
        <CardHeader className="p-8 border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold mb-1">Top Recommendations</CardTitle>
              <CardDescription className="text-gray-400">
                Prioritized action items based on audience feedback
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-8">
          <div className="space-y-4">
            {data.action_items && data.action_items.length > 0 ? (
              data.action_items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 p-6 bg-white/5 rounded-2xl border border-white/5 hover:border-blue-400/30 hover:bg-white/8 transition-all duration-300"
                >
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-blue-300 font-bold flex-shrink-0 text-lg">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-semibold text-white text-lg">{item.title}</h4>
                      <Badge
                        className={`font-medium rounded-full ${
                          item.impact === "High"
                            ? "bg-red-500/20 text-red-300 border-red-400/40"
                            : item.impact === "Medium"
                              ? "bg-yellow-500/20 text-yellow-300 border-yellow-400/40"
                              : "bg-green-500/20 text-green-300 border-green-400/40"
                        }`}
                      >
                        {item.impact} Impact
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-400 leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))
            ) : isStreaming ? (
              <div className="flex items-center gap-3 text-gray-400 py-6 justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                <span>Finding high-quality recommendations…</span>
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">
                No specific action items identified from the comments.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        {/* Summary */}
        <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-3">
          <CardHeader className="p-8 border-b border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <MessageSquare className="h-7 w-7 text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">Summary</CardTitle>
                <CardDescription className="text-gray-400">
                  AI analysis of comments
                  {summaryStreaming ? " · streaming…" : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-4">
              {summaryParagraphs.length > 0 ? (
                summaryParagraphs.map((paragraph, index) => {
                  const headingMatch = paragraph.match(/^\*\*(.*?):\*\*/);

                  if (headingMatch) {
                    const headingText = headingMatch[1];
                    const content = paragraph.replace(/^\*\*.*?:\*\*\s*/, "").trim();

                    return (
                      <div
                        key={index}
                        className="p-5 border-l-4 border-blue-400 bg-blue-500/10 rounded-r-xl"
                      >
                        <h4 className="font-semibold text-base mb-2 text-blue-300 flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full flex-shrink-0"></div>
                          {headingText}
                        </h4>
                        <p className="text-sm leading-relaxed text-gray-300">{content}</p>
                      </div>
                    );
                  }

                  const parts = paragraph.split(/(\*\*.*?\*\*)/g);

                  return (
                    <div
                      key={index}
                      className="p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/8 transition-all duration-300"
                    >
                      <p className="text-sm leading-relaxed text-gray-300">
                        {parts.map((part, i) => {
                          if (part.startsWith("**") && part.endsWith("**")) {
                            return (
                              <strong key={i} className="font-semibold text-white">
                                {part.slice(2, -2)}
                              </strong>
                            );
                          }
                          return <span key={i}>{part}</span>;
                        })}
                        {summaryStreaming && index === summaryParagraphs.length - 1 && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-400 animate-pulse align-middle" />
                        )}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                  <span>Writing summary…</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sentiment Breakdown */}
        <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-4">
          <CardHeader className="p-8 border-b border-white/5">
            <CardTitle className="text-2xl font-bold">Sentiment Breakdown</CardTitle>
            <CardDescription className="text-gray-400">Overall audience mood</CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth={2}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(10, 15, 26, 0.95)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "12px",
                      padding: "12px",
                      color: "#fff",
                      backdropFilter: "blur(20px)",
                    }}
                    formatter={(value: any, name: string) => {
                      const total =
                        data.sentiment.positive +
                        data.sentiment.neutral +
                        data.sentiment.negative;
                      const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                      return [`${value} (${percentage}%)`, name];
                    }}
                    labelStyle={{
                      color: "#fff",
                      fontWeight: "600",
                      marginBottom: "4px",
                    }}
                    itemStyle={{
                      color: "#fff",
                      fontWeight: "500",
                    }}
                  />
                  <Legend
                    wrapperStyle={{
                      fontSize: "0.9rem",
                      fontWeight: "500",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="text-center p-4 bg-white/5 rounded-2xl border border-white/5">
                <div className="flex items-center justify-center gap-2 text-blue-400 font-bold mb-2">
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-2xl">{data.sentiment.positive}</span>
                </div>
                <p className="text-sm text-gray-400 font-medium">Positive</p>
              </div>
              <div className="text-center p-4 bg-white/5 rounded-2xl border border-white/5">
                <div className="flex items-center justify-center gap-2 text-purple-400 font-bold mb-2">
                  <Minus className="h-5 w-5" />
                  <span className="text-2xl">{data.sentiment.neutral}</span>
                </div>
                <p className="text-sm text-gray-400 font-medium">Neutral</p>
              </div>
              <div className="text-center p-4 bg-white/5 rounded-2xl border border-white/5">
                <div className="flex items-center justify-center gap-2 text-pink-400 font-bold mb-2">
                  <TrendingDown className="h-5 w-5" />
                  <span className="text-2xl">{data.sentiment.negative}</span>
                </div>
                <p className="text-sm text-gray-400 font-medium">Negative</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
