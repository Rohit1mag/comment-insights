"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/StatusBanner";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  MessageSquare,
  Download,
  Loader2,
  Link2,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { useState } from "react";
import { getApiUrl } from "@/lib/api";
import { parseBriefSections } from "@/lib/brief";
import type { AnalysisData } from "@/lib/types";

interface AnalysisResultsProps {
  data: AnalysisData;
  onNewAnalysis: () => void;
  isStreaming?: boolean;
  summaryStreaming?: boolean;
  backLabel?: string;
  isDemo?: boolean;
}

const SENTIMENT_COLORS = {
  positive: "#6f9e6a",
  neutral: "#c4a574",
  negative: "#c45c4a",
};

export default function AnalysisResults({
  data,
  onNewAnalysis,
  isStreaming = false,
  summaryStreaming = false,
  backLabel = "Analyze another video",
  isDemo = false,
}: AnalysisResultsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [copied, setCopied] = useState(false);

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
    setPdfError("");
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
        throw new Error("Server returned a non-PDF response");
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
      setPdfError(error instanceof Error ? error.message : "Could not download the PDF.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/?demo=1`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const briefSections = parseBriefSections(data.summary || "");

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
          {isDemo ? (
            <Button onClick={handleShare} variant="outline" size="sm">
              <Link2 className="mr-2 h-4 w-4" />
              {copied ? "Link copied" : "Copy sample link"}
            </Button>
          ) : null}
        </div>

        {isDemo ? (
          <StatusBanner variant="info" className="mb-6">
            Sample report — no account required. Paste a real URL to analyze your own video.
          </StatusBanner>
        ) : null}

        {pdfError ? (
          <StatusBanner variant="error" className="mb-6">
            {pdfError}
          </StatusBanner>
        ) : null}

        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/70">
          {isDemo ? "Sample report" : "Analysis"}
        </p>
        <h2 className="mb-3 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          {title || "Comment brief"}
        </h2>
        <p className="text-base text-muted-foreground sm:text-lg">
          {totalCount} comments read
          {isStreaming ? " · writing the brief…" : ""}
        </p>
      </div>

      <Card className="mb-8 animate-in-2 overflow-hidden">
        <CardHeader className="border-b border-white/[0.06]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
              <CheckCircle2 className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <CardTitle className="mb-1 font-sans text-lg">What to fix next</CardTitle>
              <CardDescription>
                Ranked by how often it showed up, and how much it would change the next upload
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
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-sm font-medium tabular-nums text-amber-200">
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
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <span className="text-sm">Finding the recommendations worth keeping…</span>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-white/40">
                No specific action items stood out from these comments.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-8 animate-in-3 overflow-hidden">
        <CardHeader className="border-b border-white/[0.06]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
              <MessageSquare className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <CardTitle className="font-sans text-lg">Producer brief</CardTitle>
              <CardDescription>
                Mood, what landed, what stalled, and the ask
                {summaryStreaming ? " · streaming…" : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {briefSections.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {briefSections.map((section, index) => {
                const isLast = index === briefSections.length - 1;
                const showCursor = summaryStreaming && isLast;
                const parts = section.content.split(/(\*\*.*?\*\*)/g);

                if (section.heading) {
                  return (
                    <div
                      key={`${section.heading}-${index}`}
                      className="rounded-r-xl border-l-2 border-amber-400 bg-amber-500/10 p-4"
                    >
                      <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-amber-100">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        {section.heading}
                      </h4>
                      <p className="text-sm leading-relaxed text-white/75">
                        {section.content}
                        {showCursor ? (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle bg-amber-400" />
                        ) : null}
                      </p>
                    </div>
                  );
                }

                return (
                  <div
                    key={index}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 sm:col-span-2"
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
                      {showCursor ? (
                        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle bg-amber-400" />
                      ) : null}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
              <span className="text-sm">Writing the brief…</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-8 animate-in-4 overflow-hidden">
        <CardHeader className="border-b border-white/[0.06]">
          <CardTitle className="font-sans text-lg">Sentiment</CardTitle>
          <CardDescription>How the room felt, in three buckets</CardDescription>
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
                    backgroundColor: "rgba(22, 18, 14, 0.96)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "12px",
                    padding: "10px 12px",
                    color: "#fff",
                  }}
                  formatter={(value: number, name: string) => {
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
              <div className="mb-1 flex items-center justify-center gap-1.5 font-semibold tabular-nums text-[#8fba88]">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xl">{data.sentiment.positive}</span>
              </div>
              <p className="text-xs text-muted-foreground">Positive</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-center">
              <div className="mb-1 flex items-center justify-center gap-1.5 font-semibold tabular-nums text-[#c4a574]">
                <Minus className="h-4 w-4" />
                <span className="text-xl">{data.sentiment.neutral}</span>
              </div>
              <p className="text-xs text-muted-foreground">Neutral</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-center">
              <div className="mb-1 flex items-center justify-center gap-1.5 font-semibold tabular-nums text-[#d37a6a]">
                <TrendingDown className="h-4 w-4" />
                <span className="text-xl">{data.sentiment.negative}</span>
              </div>
              <p className="text-xs text-muted-foreground">Negative</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
