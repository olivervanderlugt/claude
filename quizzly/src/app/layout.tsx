import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Quizzly — live quizzes worth playing",
    template: "%s · Quizzly",
  },
  description:
    "Build live quizzes with ten question types, deep theming, AI-drafted questions, and blind group quizzes where everyone writes questions nobody sees until game time.",
  robots: {
    // Quizzes and live games are private by default; nothing here should be
    // indexed until an operator decides otherwise.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0c18",
  width: "device-width",
  initialScale: 1,
  // Never block zoom — players use these on phones, and pinch-to-zoom is an
  // accessibility requirement, not a nuisance.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Keyboard users shouldn't have to tab through the nav on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
