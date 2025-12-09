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
  positive: "#3b82f6",
  neutral: "#a855f7",
  negative: "#ec4899",
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
    <div className="max-w-7xl mx-auto relative z-10">
      {/* Header */}
      <div className="mb-12 animate-in-1">
        <Button 
          variant="ghost" 
          onClick={onNewAnalysis} 
          className="mb-8 glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 hover:text-white transition-all duration-300 rounded-xl px-5 py-2.5"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Analyze Another Video
        </Button>
        <h2 className="text-5xl font-bold mb-4 gradient-text" style={{ 
          backgroundImage: 'linear-gradient(135deg, hsl(210 100% 60%), hsl(265 85% 65%))',
          backgroundSize: '200% 200%',
          animation: 'gradient-shift 3s ease infinite'
        }}>
          Analysis Results
        </h2>
        <p className="text-gray-400 text-lg">
          Analyzed {data.total_comments} comments from your video
        </p>
      </div>

      {/* Action Items - Top Priority */}
      <Card className="mb-12 glass border-white/10 rounded-3xl overflow-hidden animate-in-2">
        <CardHeader className="p-8 border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold mb-1">
                Top Recommendations
              </CardTitle>
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
                      <h4 className="font-semibold text-white text-lg">
                        {item.title}
                      </h4>
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
                    <p className="text-sm text-gray-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">
                No specific action items identified from the comments.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-8 mb-12">
        {/* Summary */}
        <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-3">
          <CardHeader className="p-8 border-b border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <MessageSquare className="h-7 w-7 text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">
                  Summary
                </CardTitle>
                <CardDescription className="text-gray-400">
                  AI analysis of comments
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-4">
              {data.summary.split('\n\n').filter(p => p.trim()).map((paragraph, index) => {
                // Check if paragraph is a heading (starts with ** and ends with **)
                const headingMatch = paragraph.match(/^\*\*(.*?):\*\*/);
                
                if (headingMatch) {
                  const headingText = headingMatch[1];
                  const content = paragraph.replace(/^\*\*.*?:\*\*\s*/, '').trim();
                  
                  return (
                    <div key={index} className="p-5 border-l-4 border-blue-400 bg-blue-500/10 rounded-r-xl">
                      <h4 className="font-semibold text-base mb-2 text-blue-300 flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-400 rounded-full flex-shrink-0"></div>
                        {headingText}
                      </h4>
                      <p className="text-sm leading-relaxed text-gray-300">
                        {content}
                      </p>
                    </div>
                  );
                }
                
                // Regular paragraph - handle bold text
                const parts = paragraph.split(/(\*\*.*?\*\*)/g);
                
                return (
                  <div key={index} className="p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/8 transition-all duration-300">
                    <p className="text-sm leading-relaxed text-gray-300">
                      {parts.map((part, i) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return (
                            <strong key={i} className="font-semibold text-white">
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
        <Card className="glass border-white/10 rounded-3xl overflow-hidden animate-in-4">
          <CardHeader className="p-8 border-b border-white/5">
            <CardTitle className="text-2xl font-bold">
              Sentiment Breakdown
            </CardTitle>
            <CardDescription className="text-gray-400">
              Overall audience mood
            </CardDescription>
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
                      backgroundColor: 'rgba(10, 15, 26, 0.95)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '12px',
                      padding: '12px',
                      color: '#fff',
                      backdropFilter: 'blur(20px)'
                    }}
                    formatter={(value: any, name: string) => {
                      const total = data.sentiment.positive + data.sentiment.neutral + data.sentiment.negative;
                      const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                      return [`${value} (${percentage}%)`, name];
                    }}
                    labelStyle={{
                      color: '#fff',
                      fontWeight: '600',
                      marginBottom: '4px'
                    }}
                    itemStyle={{
                      color: '#fff',
                      fontWeight: '500'
                    }}
                  />
                  <Legend 
                    wrapperStyle={{
                      fontSize: '0.9rem',
                      fontWeight: '500'
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

      {/* Comments Browser */}
      <Card className="glass border-white/10 rounded-3xl overflow-hidden">
        <CardHeader className="p-8 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold mb-2">Comment Browser</CardTitle>
              <CardDescription className="text-gray-400 text-base">
                {filteredComments.length} of {data.comments.length} comments
              </CardDescription>
            </div>
            {hasActiveFilters && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={clearFilters}
                className="glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 rounded-xl"
              >
                <X className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-8">
          {/* Filters */}
          <div className="mb-8 space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Filter className="h-5 w-5 text-gray-400" />
              <Button
                variant={sentimentFilter.includes("positive") ? "default" : "outline"}
                size="sm"
                onClick={() => toggleSentimentFilter("positive")}
                className={`rounded-xl ${
                  sentimentFilter.includes("positive")
                    ? "bg-blue-500 hover:bg-blue-400 text-white"
                    : "glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300"
                }`}
              >
                <TrendingUp className="mr-1.5 h-4 w-4" />
                Positive
              </Button>
              <Button
                variant={sentimentFilter.includes("neutral") ? "default" : "outline"}
                size="sm"
                onClick={() => toggleSentimentFilter("neutral")}
                className={`rounded-xl ${
                  sentimentFilter.includes("neutral")
                    ? "bg-purple-500 hover:bg-purple-400 text-white"
                    : "glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300"
                }`}
              >
                <Minus className="mr-1.5 h-4 w-4" />
                Neutral
              </Button>
              <Button
                variant={sentimentFilter.includes("negative") ? "default" : "outline"}
                size="sm"
                onClick={() => toggleSentimentFilter("negative")}
                className={`rounded-xl ${
                  sentimentFilter.includes("negative")
                    ? "bg-pink-500 hover:bg-pink-400 text-white"
                    : "glass border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300"
                }`}
              >
                <TrendingDown className="mr-1.5 h-4 w-4" />
                Negative
              </Button>
            </div>

            <div className="flex gap-3">
              <Input
                type="text"
                placeholder="Search comments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 focus:border-blue-400/50 text-white placeholder:text-gray-500 rounded-xl"
              />
              <Input
                type="number"
                placeholder="Min likes"
                value={minLikes || ""}
                onChange={(e) => setMinLikes(Number(e.target.value) || 0)}
                className="w-36 bg-white/5 border border-white/10 focus:border-blue-400/50 text-white placeholder:text-gray-500 rounded-xl"
                min="0"
              />
            </div>
          </div>

          {/* Comments List */}
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredComments.length > 0 ? (
              filteredComments.map((comment, index) => (
                <div
                  key={index}
                  className="p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/8 transition-all duration-300"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                        <User className="h-4 w-4 text-blue-400" />
                      </div>
                      <span className="font-medium text-white">{comment.author}</span>
                      {comment.sentiment && (
                        <Badge
                          variant="outline"
                          className={`rounded-full font-medium ${
                            comment.sentiment === "positive"
                              ? "border-blue-400/40 text-blue-300 bg-blue-500/10"
                              : comment.sentiment === "negative"
                              ? "border-pink-400/40 text-pink-300 bg-pink-500/10"
                              : "border-purple-400/40 text-purple-300 bg-purple-500/10"
                          }`}
                        >
                          {comment.sentiment}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <div className="flex items-center gap-1.5">
                        <ThumbsUp className="h-4 w-4" />
                        {comment.like_count}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4" />
                        {new Date(comment.published_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {comment.text}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center py-16 text-gray-500">
                <AlertCircle className="h-14 w-14 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-medium">No comments match your filters</p>
                <p className="text-sm mt-2">Try adjusting your filters</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

<style jsx global>{`
  .custom-scrollbar::-webkit-scrollbar {
    width: 8px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(59, 130, 246, 0.5);
    border-radius: 4px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(59, 130, 246, 0.7);
  }
`}</style>

