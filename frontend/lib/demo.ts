import type { AnalysisData } from "@/lib/types";

export const DEMO_ANALYSIS: AnalysisData = {
  video_id: "demo-m4-mac-mini",
  video_title: "I switched my entire studio to the M4 Mac Mini — 30 days later",
  total_comments: 842,
  summary:
    "**Overall mood:** Viewers are impressed by the machine, but they came for a buying decision — and left with unanswered questions about real editing workloads.\n\n**What landed:** The before/after export times and the desk-cable teardown were the two moments people clipped and quoted. Several editors said this is the first M4 video that felt like it was shot in an actual edit bay, not a unboxing set.\n\n**What stalled:** A loud cluster of Premiere and DaVinci users felt skipped. They wanted timeline-scrubbing footage, not Geekbench screenshots. Audio comments also piled up in the first 48 hours — the lav is thin and the room tone is busy.\n\n**The ask:** A follow-up that puts the Mini next to a used Mac Studio on the same 4K multicam project, with chapter markers so people can jump to their NLE.",
  sentiment: {
    positive: 512,
    neutral: 201,
    negative: 129,
  },
  action_items: [
    {
      title: "Show the NLE, not the benchmark",
      description:
        "The most-liked critical comments all ask the same thing: scrub a 4K multicam timeline in Premiere, Final Cut, and DaVinci. Bench scores are not converting skeptics.",
      impact: "High",
    },
    {
      title: "Fix the lav and kill the HVAC",
      description:
        "Audio is the #1 complaint in the first two days. A cleaner voice track would have saved the whole first act — several otherwise-positive viewers bounced before the export test.",
      impact: "High",
    },
    {
      title: "Add chapters at the decision points",
      description:
        "Viewers keep asking where the price breakdown, thermals, and 'should I buy' sections are. Chapters would also lift session time on a 24-minute video.",
      impact: "Medium",
    },
    {
      title: "Answer the Mac Studio comparison",
      description:
        "Used Studio vs new Mini is the comment-section argument. A pinned comment or a 60-second follow-up short would stop the same thread repeating.",
      impact: "Medium",
    },
    {
      title: "Pin a spec card in the description",
      description:
        "RAM, storage, and which Mini configuration you actually bought got asked more than 40 times. Put it above the fold so the comments can be about the work.",
      impact: "Low",
    },
  ],
};
