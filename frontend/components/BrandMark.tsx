import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  wordmark = true,
}: {
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="relative flex h-8 w-8 shrink-0 items-center justify-center"
        aria-hidden
      >
        <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none">
          <rect
            x="3"
            y="3"
            width="26"
            height="26"
            rx="8"
            className="fill-amber-400/15 stroke-amber-400/50"
            strokeWidth="1.25"
          />
          <path
            d="M10 9.5h12M16 9.5v4.2c0 1.4.7 2.7 1.9 3.5l3.6 2.3c1.4.9 1.4 3 0 3.9l-3.6 2.3A4.2 4.2 0 0 0 16 27.5"
            className="stroke-amber-300"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="21.2" r="1.35" className="fill-amber-300" />
        </svg>
      </span>
      {wordmark ? (
        <span className="font-display text-[1.35rem] font-medium leading-none tracking-tight text-[hsl(var(--foreground))]">
          Disstill
        </span>
      ) : null}
    </span>
  );
}
