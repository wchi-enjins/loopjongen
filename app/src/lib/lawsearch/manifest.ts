import { existsSync, readFileSync } from "node:fs";

export type CatalogEntry = { id: string; title: string; type: string; authority: string; areas: string[]; domains: string[] };

// data/bwb/manifest.json is written by scripts/bwb_sync.ts; the cwd is app/ under Next.js and the repo root in the benchmarks.
const FILES = [process.env.BWB_MANIFEST, "../data/bwb/manifest.json", "data/bwb/manifest.json"];
let cached: CatalogEntry[] | undefined;

/** All BWB regulations in force (titles + metadata); throws when the manifest has not been downloaded. */
export function catalog(): CatalogEntry[] {
  if (cached) return cached;
  const file = FILES.find((f) => f && existsSync(f));
  if (!file) throw new Error("BWB-catalogus ontbreekt: draai scripts/bwb_sync.ts (of zet BWB_MANIFEST)");
  return (cached = (JSON.parse(readFileSync(file, "utf8")) as { entries: CatalogEntry[] }).entries);
}
