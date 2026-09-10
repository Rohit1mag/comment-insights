export interface Sentiment {
  positive: number;
  neutral: number;
  negative: number;
}

export interface ActionItem {
  title: string;
  description: string;
  impact: string;
}

export interface AnalysisData {
  video_id?: string;
  video_title?: string;
  total_comments?: number;
  summary: string;
  sentiment: Sentiment;
  action_items: ActionItem[];
}
