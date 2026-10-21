"use client";

import Generator from "@/components/generator";
import { TEMPLATES } from "@/lib/templates";

export default function GeneratePage() {
  return (
    <Generator
      templates={TEMPLATES}
      title="Documenten genereren"
    />
  );
}
