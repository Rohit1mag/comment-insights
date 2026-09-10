"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Lightbulb, Search } from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { UsageChip, type UsageData } from "@/components/UsageChip";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Analyze", icon: Search },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/history", label: "History", icon: History },
] as const;

export function SiteHeader({ usage }: { usage?: UsageData | null }) {
  const pathname = usePathname();
  const { isLoaded } = useUser();

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#16120e]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Disstill home">
          <BrandMark className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-amber-400/10 text-amber-100"
                    : "text-white/55 hover:bg-white/5 hover:text-white"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <nav className="flex items-center gap-1 md:hidden" aria-label="Primary">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  active
                    ? "bg-amber-400/10 text-amber-200"
                    : "text-white/55 hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {usage ? <UsageChip usage={usage} /> : null}

          {!isLoaded ? (
            <div className="flex items-center gap-2" aria-hidden>
              <div className="h-9 w-16 animate-pulse rounded-lg bg-white/5" />
              <div className="h-9 w-24 animate-pulse rounded-lg bg-white/10" />
            </div>
          ) : null}

          <SignedOut>
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button size="sm">Get started</Button>
            </SignUpButton>
          </SignedOut>

          <SignedIn>
            <UserButton
              appearance={{
                elements: {
                  avatarBox:
                    "h-8 w-8 ring-2 ring-amber-400/30 ring-offset-2 ring-offset-[#16120e]",
                },
              }}
            />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
