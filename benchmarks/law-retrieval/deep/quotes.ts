/**
 * Deterministic quote check: a quote passes when it appears word for word in the source text, after normalising
 * what PDF and HTML extraction varies on (whitespace, quote marks, dashes, soft hyphens, footnote markers).
 *   node benchmarks/law-retrieval/deep/quotes.ts   runs the self-check
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function normalize(s: string): string {
  return s
    .normalize("NFKC") // ligatures, nbsp, superscript digits
    .replace(/[­​-‍﻿]/g, "")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/(\p{L})\d+(?=[\s.,;:)]|$)/gu, "$1") // footnote digits glued to a word: "consument12 is" -> "consument is"
    .replace(/\s+/g, " ")
    .trim();
}

export function checkQuote(quote: string, text: string): boolean {
  const q = normalize(quote);
  return q.length > 0 && normalize(text).includes(q);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = "De ondernemer handelt  oneerlijk\n als hij “van-voor-nu”­prijzen gebruikt3 – zie art. 6:193b BW.";
  assert.ok(checkQuote("handelt oneerlijk als hij", text), "whitespace");
  assert.ok(checkQuote('"van-voor-nu"prijzen', text), "curly quotes + soft hyphen");
  assert.ok(checkQuote("prijzen gebruikt - zie art. 6:193b BW", text), "footnote digit + dash");
  assert.ok(!checkQuote("handelt eerlijk", text), "negative");
  assert.ok(!checkQuote("  ", text), "empty quote");
  console.log("quotes.ts: ok");
}
