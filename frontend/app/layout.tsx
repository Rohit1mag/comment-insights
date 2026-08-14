import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Disstill — Turn YouTube Comments into Actionable Feedback",
  description:
    "AI-powered analysis that transforms YouTube comments into clear, actionable insights.",
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
          colorPrimary: "#60a5fa",
          colorBackground: "#0b1220",
          colorInputBackground: "#121a2b",
          colorNeutral: "#94a3b8",
          colorText: "#f1f5f9",
          colorTextSecondary: "#94a3b8",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html lang="en" className={`dark ${dmSans.variable}`}>
        <body className={`${dmSans.className} min-h-screen`}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
