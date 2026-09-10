import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-display",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Disstill — Comment intelligence for YouTube",
  description:
    "Paste a YouTube URL. Disstill reads the comments and returns sentiment, a producer-style brief, and the next things to fix.",
  openGraph: {
    title: "Disstill — Comment intelligence for YouTube",
    description:
      "Turn a comment section into a short brief: mood, patterns, and what to change next.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#e0a04a",
          colorBackground: "#16120e",
          colorInputBackground: "#1c1814",
          colorNeutral: "#a89f93",
          colorText: "#f3ece2",
          colorTextSecondary: "#a89f93",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html
        lang="en"
        className={`dark ${display.variable} ${sans.variable} ${mono.variable}`}
      >
        <body className={`${sans.className} relative min-h-screen`}>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
