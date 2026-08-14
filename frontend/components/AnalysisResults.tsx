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
import { getApiUrl } from "@/lib/api";

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
  // History reuses this view, where the back button returns to the list
  backLabel?: string;
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
  backLabel = "Analyze Another Video",
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
      const response = await fetch(`${getApiUrl()}/analyze/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
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
    <div className="mx-auto max-w-5xl">
      <div className="mb-10 animate-in-1">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button onClick={onNewAnalysis} variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Button>
          <Button
            onClick={handleDownloadPDF}
            disabled={isDownloading || isStreaming || !data.summary}
            variant="outline"
            size="sm"
          >
            <Download className="mr-2 h-4 w-4" />
            {isDownloading ? "Generating PDF…" : "Download PDF"}
          </Button>
        </div>
        <h2 className="gradient-text mb-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Analysis results
        </h2>
        <p className="text-base text-muted-foreground sm:text-lg">
          Analyzed {totalCount} comments from your video
          {isStreaming ? " · generating insights…" : ""}
        </p>
        {title ? <p className="mt-2 font-medium text-white/80">{title}</p> : null}
      </div>

      <Card className="mb-8 animate-in-2 overflow-hidden">
        <CardHeader className="border-b border-white/[0.06]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20">
              <CheckCircle2 className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="mb-1">Top recommendations</CardTitle>
              <CardDescription>
                Prioritized action items based on audience feedback
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="space-y-2">
            {data.action_items && data.action_items.length > 0 ? (
              data.action_items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 rounded-xl border border-transparent p-4 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-sm font-semibold tabular-nums text-blue-300">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h4 className="font-medium text-white">{item.title}</h4>
                      <Badge
                        className={
                          item.impact === "High"
                            ? "border-red-400/30 bg-red-500/10 text-red-200"
                            : item.impact === "Medium"
                              ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                              : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                        }
                      >
                        {item.impact} impact
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))
            ) : isStreaming ? (
              <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                <span className="text-sm">Finding high-quality recommendations…</span>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-white/40">
                No specific action items identified from the comments.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card className="animate-in-3 overflow-hidden">
          <CardHeader className="border-b border-white/[0.06]">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
                <MessageSquare className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <CardTitle>Summary</CardTitle>
                <CardDescription>
                  AI analysis of comments
                  {summaryStreaming ? " · streaming…" : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="space-y-3">
              {summaryParagraphs.length > 0 ? (
                summaryParagraphs.map((paragraph, index) => {
                  const headingMatch = paragraph.match(/^\*\*(.*?):\*\*/);

                  if (headingMatch) {
                    const headingText = headingMatch[1];
                    const content = paragraph.replace(/^\*\*.*?:\*\*\s*/, "").trim();

                    return (
                      <div
                        key={index}
                        className="rounded-r-xl border-l-2 border-blue-400 bg-blue-500/10 p-4"
                      >
                        <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-blue-200">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                          {headingText}
                        </h4>
                        <p className="text-sm leading-relaxed text-white/75">{content}</p>
                      </div>
                    );
                  }

                  const parts = paragraph.split(/(\*\*.*?\*\*)/g);

                  return (
                    <div
                      key={index}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"
                    >
                      <p className="text-sm leading-relaxed text-white/75">
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
                        {summaryStreaming && index === summaryParagraphs.length - 1 ? (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle bg-blue-400" />
                        ) : null}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                  <span className="text-sm">Writing summary…</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="animate-in-4 overflow-hidden">
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle>Sentiment breakdown</CardTitle>
            <CardDescription>Overall audience mood</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={2}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(11, 18, 32, 0.95)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "12px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                    formatter={(value: any, name: string) => {
                      const total =
                        data.sentiment.positive +
                        data.sentiment.neutral +
                        data.sentiment.negative;
                      const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                      return [`${value} (${percentage}%)`, name];
                    }}
                    labelStyle={{ color: "#fff", fontWeight: "600", marginBottom: "4px" }}
                    itemStyle={{ color: "#fff", fontWeight: "500" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.8rem", fontWeight: "500" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-center">
                <div className="mb-1 flex items-center justify-center gap-1.5 font-semibold tabular-nums text-blue-400">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xl">{data.sentiment.positive}</span>
                </div>
                <p className="text-xs text-muted-foreground">Positive</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-center">
                <div className="mb-1 flex items-center justify-center gap-1.5 font-semibold tabular-nums text-violet-400">
                  <Minus className="h-4 w-4" />
                  <span className="text-xl">{data.sentiment.neutral}</span>
                </div>
                <p className="text-xs text-muted-foreground">Neutral</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-center">
                <div className="mb-1 flex items-center justify-center gap-1.5 font-semibold tabular-nums text-pink-400">
                  <TrendingDown className="h-4 w-4" />
                  <span className="text-xl">{data.sentiment.negative}</span>
                </div>
                <p className="text-xs text-muted-foreground">Negative</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
