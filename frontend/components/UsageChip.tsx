import { Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UsageData {
  used: number;
  remaining: number;
  limit: number;
  is_unlimited: boolean;
  tier: string;
  guest?: boolean;
}

export function UsageChip({ usage }: { usage: UsageData }) {
  const isPro = usage.tier === "PRO";

  if (usage.is_unlimited) {
    return (
      <div className="hidden items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 sm:flex">
        <Zap className="h-3.5 w-3.5" />
        Unlimited
      </div>
    );
  }

  if (usage.guest) {
    return (
      <div
        className={cn(
          "hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium sm:flex",
          usage.remaining > 0
            ? "border-blue-400/20 bg-blue-500/10 text-blue-200"
            : "border-amber-400/20 bg-amber-500/10 text-amber-200"
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {usage.remaining > 0 ? "1 free analysis" : "Sign up for more"}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium sm:flex",
        isPro
          ? "border-amber-400/20 bg-amber-500/10 text-amber-200"
          : "border-blue-400/20 bg-blue-500/10 text-blue-200"
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className="tabular-nums">
        <span className="font-semibold text-white">{usage.remaining}</span>
        <span className="text-white/40"> / {usage.limit}</span>
      </span>
      {isPro ? <span className="text-amber-400/80">Pro</span> : null}
    </div>
  );
}
