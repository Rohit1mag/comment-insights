"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  ThumbsUp,
  Calendar,
  User,
  Filter,
  X,
  MessageSquare,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface Comment {
  author: string;
  text: string;
  like_count: number;
  published_at: string;
  sentiment?: string;
}

interface AnalysisData {
  video_id: string;
  total_comments: number;
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
  comments: Comment[];
}

interface AnalysisResultsProps {
  data: AnalysisData;
  onNewAnalysis: () => void;
}

const SENTIMENT_COLORS = {
  positive: "#10b981",
  neutral: "#f59e0b",
  negative: "#ef4444",
};

export default function AnalysisResults({ data, onNewAnalysis }: AnalysisResultsProps) {
  const [sentimentFilter, setSentimentFilter] = useState<string[]>([]);
  const [minLikes, setMinLikes] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");

  // Prepare chart data
  const chartData = [
    { name: "Positive", value: data.sentiment.positive, color: SENTIMENT_COLORS.positive },
    { name: "Neutral", value: data.sentiment.neutral, color: SENTIMENT_COLORS.neutral },
    { name: "Negative", value: data.sentiment.negative, color: SENTIMENT_COLORS.negative },
  ];

  // Filter comments
  const filteredComments = data.comments.filter((comment) => {
    if (sentimentFilter.length > 0 && comment.sentiment && !sentimentFilter.includes(comment.sentiment)) {
      return false;
    }
    if (comment.like_count < minLikes) {
      return false;
    }
    if (searchTerm && !comment.text.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

  const toggleSentimentFilter = (sentiment: string) => {
    setSentimentFilter((prev) =>
      prev.includes(sentiment) ? prev.filter((s) => s !== sentiment) : [...prev, sentiment]
    );
  };

  const clearFilters = () => {
    setSentimentFilter([]);
    setMinLikes(0);
    setSearchTerm("");
  };

  const hasActiveFilters = sentimentFilter.length > 0 || minLikes > 0 || searchTerm !== "";

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Button variant="ghost" onClick={onNewAnalysis} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Analyze Another Video
        </Button>
        <h2 className="text-3xl font-bold mb-2">Analysis Results</h2>
        <p className="text-muted-foreground">
          Analyzed {data.total_comments} comments from your video
        </p>
      </div>

      {/* Action Items - Top Priority */}
      <Card className="mb-8 border-2 border-primary/20 bg-gradient-to-br from-blue-50 to-purple-50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-primary" />
            <CardTitle>Top Recommendations</CardTitle>
          </div>
          <CardDescription>
            Prioritized action items based on your audience feedback
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.action_items && data.action_items.length > 0 ? (
              data.action_items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 p-4 bg-white rounded-lg shadow-sm border"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">{item.title}</h4>
                      <Badge
                        variant={
                          item.impact === "High"
                            ? "destructive"
                            : item.impact === "Medium"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {item.impact} Impact
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No specific action items identified from the comments.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-8 mb-8">
        {/* Summary */}
        <Card className="border-2 border-primary/10 bg-gradient-to-br from-slate-50 to-blue-50/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle>Summary</CardTitle>
                <CardDescription>AI analysis of your comments</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.summary.split('\n\n').filter(p => p.trim()).map((paragraph, index) => {
                // Check if paragraph is a heading (starts with ** and ends with **)
                const headingMatch = paragraph.match(/^\*\*(.*?):\*\*/);
                
                if (headingMatch) {
                  const headingText = headingMatch[1];
                  const content = paragraph.replace(/^\*\*.*?:\*\*\s*/, '').trim();
                  
                  return (
                    <div key={index} className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                      <h4 className="font-semibold text-base mb-2 text-slate-900 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></div>
                        {headingText}
                      </h4>
                      <p className="text-sm leading-relaxed text-slate-700">
                        {content}
                      </p>
                    </div>
                  );
                }
                
                // Regular paragraph - handle bold text
                const parts = paragraph.split(/(\*\*.*?\*\*)/g);
                
                return (
                  <div key={index} className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-sm leading-relaxed text-slate-700">
                      {parts.map((part, i) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return (
                            <strong key={i} className="font-semibold text-slate-900">
                              {part.slice(2, -2)}
                            </strong>
                          );
                        }
                        return <span key={i}>{part}</span>;
                      })}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Sentiment Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Sentiment Breakdown</CardTitle>
            <CardDescription>Overall audience mood</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-green-600 font-semibold">
                  <TrendingUp className="h-4 w-4" />
                  {data.sentiment.positive}
                </div>
                <p className="text-xs text-muted-foreground">Positive</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-yellow-600 font-semibold">
                  <Minus className="h-4 w-4" />
                  {data.sentiment.neutral}
                </div>
                <p className="text-xs text-muted-foreground">Neutral</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-red-600 font-semibold">
                  <TrendingDown className="h-4 w-4" />
                  {data.sentiment.negative}
                </div>
                <p className="text-xs text-muted-foreground">Negative</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comments Browser */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Comment Browser</CardTitle>
              <CardDescription>
                {filteredComments.length} of {data.comments.length} comments
              </CardDescription>
            </div>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <Button
                variant={sentimentFilter.includes("positive") ? "default" : "outline"}
                size="sm"
                onClick={() => toggleSentimentFilter("positive")}
              >
                <TrendingUp className="mr-1 h-3 w-3" />
                Positive
              </Button>
              <Button
                variant={sentimentFilter.includes("neutral") ? "default" : "outline"}
                size="sm"
                onClick={() => toggleSentimentFilter("neutral")}
              >
                <Minus className="mr-1 h-3 w-3" />
                Neutral
              </Button>
              <Button
                variant={sentimentFilter.includes("negative") ? "default" : "outline"}
                size="sm"
                onClick={() => toggleSentimentFilter("negative")}
              >
                <TrendingDown className="mr-1 h-3 w-3" />
                Negative
              </Button>
            </div>

            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Search comments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1"
              />
              <Input
                type="number"
                placeholder="Min likes"
                value={minLikes || ""}
                onChange={(e) => setMinLikes(Number(e.target.value) || 0)}
                className="w-32"
                min="0"
              />
            </div>
          </div>

          {/* Comments List */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {filteredComments.length > 0 ? (
              filteredComments.map((comment, index) => (
                <div
                  key={index}
                  className="p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{comment.author}</span>
                      {comment.sentiment && (
                        <Badge
                          variant="outline"
                          className={
                            comment.sentiment === "positive"
                              ? "border-green-500 text-green-700"
                              : comment.sentiment === "negative"
                              ? "border-red-500 text-red-700"
                              : "border-yellow-500 text-yellow-700"
                          }
                        >
                          {comment.sentiment}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <ThumbsUp className="h-3 w-3" />
                        {comment.like_count}
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(comment.published_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {comment.text}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No comments match your filters</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

