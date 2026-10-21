import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Nav from "@/components/nav";
import Feedback from "@/components/feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loopjongen",
  description: "AI-chat, documentanalyse, documentgeneratie en zoeken in Nederlandse wetgeving en rechtspraak.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/" className="brand">
              <img src="/loopjongen.svg" alt="" width={22} height={22} />
              Loopjongen
            </Link>
            <Nav />
          </aside>
          <main className="main">{children}</main>
        </div>
        <Feedback />
      </body>
    </html>
  );
}
