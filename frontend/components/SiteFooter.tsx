import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <p>
          <span className="font-display text-base text-foreground/80">Disstill</span>
          <span className="mx-2 text-white/20">·</span>
          Comment intelligence for YouTube
        </p>
        <div className="flex items-center gap-4">
          <Link href="/?demo=1" className="transition-colors hover:text-amber-200">
            Sample report
          </Link>
          <a
            href="https://github.com/Rohit1mag/comment-insights"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-amber-200"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
