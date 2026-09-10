import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Lightbulb } from "lucide-react";

export interface InspiredByVideo {
  channel_title: string;
  video_title: string;
  video_id: string;
  url: string;
  view_count: number;
}

export interface VideoIdea {
  title: string;
  hook: string;
  angle: string;
  why_it_works: string;
  inspired_by: InspiredByVideo[];
}

function WritingCursor() {
  return (
    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle bg-amber-400" />
  );
}

function IdeaField({
  label,
  value,
  streaming,
  showCursor,
}: {
  label: string;
  value?: string;
  streaming?: boolean;
  showCursor?: boolean;
}) {
  if (!value && !streaming) return null;
  if (!value && streaming) {
    return (
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">
          {label}
        </p>
        <div className="h-3 w-4/5 animate-pulse rounded bg-white/5" />
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-white/75">
        {value}
        {showCursor ? <WritingCursor /> : null}
      </p>
    </div>
  );
}

export function IdeaCard({
  idea,
  index,
  streaming = false,
}: {
  idea: Partial<VideoIdea>;
  index: number;
  streaming?: boolean;
}) {
  const fields = [
    { key: "hook" as const, label: "Hook", value: idea.hook },
    { key: "angle" as const, label: "Your angle", value: idea.angle },
    {
      key: "why_it_works" as const,
      label: "Why it works",
      value: idea.why_it_works,
    },
  ];
  const lastFilled = [...fields].reverse().find((field) => field.value)?.key;
  const inspiredBy = idea.inspired_by ?? [];

  return (
    <Card
      className={`flex flex-col overflow-hidden transition-colors ${
        streaming
          ? "border-amber-400/25 bg-amber-500/[0.04]"
          : "hover:border-amber-400/20 hover:bg-white/[0.05]"
      }`}
    >
      <CardHeader className="pb-3">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
            <Lightbulb className="h-4 w-4 text-amber-300" />
          </div>
          <Badge className="border-amber-400/25 bg-amber-500/10 text-amber-200">
            {streaming ? `Writing ${index + 1}` : `Idea ${index + 1}`}
          </Badge>
        </div>
        <CardTitle className="text-base leading-snug text-white">
          {idea.title || (streaming ? "Finding the title…" : "Untitled")}
          {streaming && !lastFilled ? <WritingCursor /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-4 pt-0">
        {fields.map((field) => (
          <IdeaField
            key={field.key}
            label={field.label}
            value={field.value}
            streaming={streaming}
            showCursor={streaming && lastFilled === field.key}
          />
        ))}
        {inspiredBy.length > 0 ? (
          <div className="mt-auto border-t border-white/5 pt-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              Inspired by
            </p>
            <ul className="space-y-2">
              {inspiredBy.map((ref) => {
                const key = `${ref.video_id}-${ref.video_title}`;
                const label = ref.channel_title
                  ? `${ref.channel_title}: ${ref.video_title}`
                  : ref.video_title;
                if (ref.url) {
                  return (
                    <li key={key}>
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1.5 text-xs text-amber-200 transition-colors hover:text-amber-100"
                      >
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{label}</span>
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={key} className="text-xs text-muted-foreground">
                    {label}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function IdeaSkeleton({ label }: { label?: string }) {
  return (
    <div
      className="flex h-52 flex-col justify-end rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5"
      aria-hidden
    >
      <div className="mb-3 h-3 w-16 animate-pulse rounded bg-white/5" />
      <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-white/5" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
      {label ? (
        <p className="mt-4 text-xs text-white/35">{label}</p>
      ) : null}
    </div>
  );
}
