"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/instellingen", label: "Templates" },
  { href: "/instellingen/feedback", label: "Feedback" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <div className="page-head">
        <h1>Instellingen</h1>
      </div>
      <nav className="tabs" aria-label="Instellingen">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={path === t.href ? "active" : ""}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
