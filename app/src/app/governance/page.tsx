"use client";

import Generator from "@/components/Generator";
import { GOVERNANCE } from "@/lib/templates";

export default function GovernancePage() {
  return (
    <Generator
      templates={GOVERNANCE}
      title="Governancemodel"
      intro="Vul rechtsvorm, omvang en bestuursmodel in; de governancestructuur wordt direct afgeleid uit Boek 2 BW, inclusief structuurregime en bevoegdhedenmatrix."
    />
  );
}
