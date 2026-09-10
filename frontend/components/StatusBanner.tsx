import { cn } from "@/lib/utils";

const variants = {
  error: "border-red-400/25 bg-red-500/10 text-red-200",
  info: "border-amber-400/25 bg-amber-500/10 text-amber-100",
  warning: "border-amber-400/25 bg-amber-500/10 text-amber-100",
} as const;

export function StatusBanner({
  variant,
  children,
  action,
  className,
}: {
  variant: keyof typeof variants;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium",
        variants[variant],
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">{children}</div>
      {action}
    </div>
  );
}
