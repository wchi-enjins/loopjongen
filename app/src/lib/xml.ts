import { XMLParser } from "fast-xml-parser";

export type XNode = Record<string, unknown>;

const ordered = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  trimValues: false,
  removeNSPrefix: true,
  ignorePiTags: true,
});

const plain = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  isArray: (name) => ["record", "rechtsgebied"].includes(name),
});

export const parseOrdered = (xml: string) => ordered.parse(xml) as XNode[];
export const parsePlain = (xml: string) => plain.parse(xml) as Record<string, unknown>;

export function tagOf(node: XNode): string | undefined {
  return Object.keys(node).find((k) => k !== ":@");
}
export function childrenOf(node: XNode): XNode[] {
  const t = tagOf(node);
  return t && Array.isArray(node[t]) ? (node[t] as XNode[]) : [];
}
export function attrsOf(node: XNode): Record<string, string> {
  return (node[":@"] as Record<string, string>) ?? {};
}

/** Flatten a node to text; tags in `blocks` end with a newline, tags in `skip` are dropped. */
export function flatten(nodes: XNode[], blocks: Set<string>, skip: Set<string>): string {
  let out = "";
  for (const n of nodes) {
    const t = tagOf(n);
    if (!t) continue;
    if (t === "#text") {
      out += String(n[t]);
      continue;
    }
    if (skip.has(t)) continue;
    const inner = flatten(childrenOf(n), blocks, skip);
    out += blocks.has(t) ? `\n${inner}\n` : inner;
  }
  return out;
}

export function tidy(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function findFirst(nodes: XNode[], tag: string): XNode | undefined {
  for (const n of nodes) {
    if (tagOf(n) === tag) return n;
    const hit = findFirst(childrenOf(n), tag);
    if (hit) return hit;
  }
  return undefined;
}
