import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import type { UsageData } from "@/components/UsageChip";

export function AppShell({
  children,
  usage,
}: {
  children: React.ReactNode;
  usage?: UsageData | null;
}) {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <SiteHeader usage={usage} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
