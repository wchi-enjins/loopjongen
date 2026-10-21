"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "AI-chat" },
  { href: "/documenten", label: "Documenten" },
  { href: "/recordings", label: "Opnames", icon: "/granola.png" },
  { href: "/genereren", label: "Genereren" },
  { href: "/klanten", label: "Klanten" },
  { href: "/governance", label: "Governance" },
  { href: "/zoeken", label: "Wetten & rechtspraak" },
  { href: "/instellingen", label: "Instellingen", bottom: true },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Hoofdmenu">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={[(l.href === "/" ? path === "/" : path.startsWith(l.href)) && "active", l.bottom && "nav-bottom"].filter(Boolean).join(" ")}>
          {l.label}
          {l.icon && <img src={l.icon} alt="Granola" width={16} height={16} className="nav-icon" />}
        </Link>
      ))}
    </nav>
  );
}
