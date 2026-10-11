/**
 * Document templates. Rendered text uses a small line-based markup shared by
 * the preview, the AI refinement step and the .docx export:
 *   "# "  document title       "## " section heading
 *   "SIGN: left || right"      signature block
 *   blank line                 paragraph break
 */

export type Values = Record<string, string>;

export type Field = {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "number" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  default?: string;
  showIf?: (v: Values) => boolean;
  /** Select options the law probably does not allow for these values; shown as advised against, still selectable. */
  discouraged?: (value: string, v: Values) => boolean;
};

export type Source = { label: string; url: string };

export type Template = {
  id: string;
  title: string;
  description: string;
  sources: Source[];
  /** advanced: shown collapsed on /genereren ("Meer opties"). */
  groups: { title: string; fields: Field[]; advanced?: boolean }[];
  checks: (v: Values) => string[];
  /** Drafting requirements given to the AI when it edits or reviews the draft. */
  rules?: string[];
  /** Clause texts that can be changed on /instellingen. */
  clauses?: Clauses;
  /** custom: clause texts from /instellingen; extra: the firm's own standard clauses, added before the closing article. */
  render: (v: Values, custom?: ClauseTexts, extra?: ExtraClause[]) => string;
};

/** Default clause texts; {{name}} is filled with the value render passes in. */
export type Clauses = Record<string, { label: string; text: string }>;
/** Custom clause texts by clause key, as saved on /instellingen. */
export type ClauseTexts = Record<string, string>;
/** A firm's own standard clause, added to every document of a template. */
export type ExtraClause = { title: string; text: string };

export const placeholders = (text: string) => [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];

const clauseFn = (defs: Clauses, custom: ClauseTexts = {}, vars: Record<string, string>) => {
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
  return Object.assign((key: string) => fill(custom[key]?.trim() ? custom[key] : defs[key].text), { fill });
};

// ---------- helpers ----------

const BW = { 2: "BWBR0003045", 3: "BWBR0005291", 6: "BWBR0005289", 7: "BWBR0005290" } as const;
const art = (book: 2 | 3 | 6 | 7, nr: string): Source => ({
  label: `Art. ${book}:${nr} BW`,
  url: `https://wetten.overheid.nl/jci1.3:c:${BW[book]}&artikel=${nr}`,
});
const law = (label: string, id: string, artikel?: string): Source => ({
  label,
  url: artikel ? `https://wetten.overheid.nl/jci1.3:c:${id}&artikel=${artikel}` : `https://wetten.overheid.nl/${id}`,
});

const blank = (s: string | undefined, placeholder = "[...]") => (s && s.trim() ? s.trim() : placeholder);

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "[datum]";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "[datum]";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export function eur(n: number | string | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (v === undefined || isNaN(v)) return "€ [bedrag]";
  return "€ " + v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const num = (s: string | undefined) => (s ? parseFloat(s.replace(",", ".")) : NaN);

// ponytail: statutory amounts are hard-coded; update them when they change (WML on 1 Jan / 1 Jul, interest rates twice a year, transitievergoeding cap every 1 Jan).
/** Wettelijk minimumloon per uur vanaf 21 jaar, per 1 juli 2026. */
const WML_UUR = 14.99;
/** Wettelijke rente (6:119 BW) per 1 januari 2026 and handelsrente (6:119a BW) per 1 juli 2026. */
const RENTE = { consument: "4%", zakelijk: "10,4%" };
/** Maximum transitievergoeding 2026 (art. 7:673 lid 2 BW), unless one year's salary is higher. */
const TRANSITIE_MAX = 102_000;

function monthsBetween(a: string, b: string): number {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return NaN;
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + (d2.getDate() - d1.getDate() + 1) / 31;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Besluit vergoeding voor buitengerechtelijke incassokosten, art. 2. */
export function incassokosten(hoofdsom: number): number {
  if (!(hoofdsom > 0)) return 0;
  const brackets: [number, number][] = [
    [2500, 0.15],
    [2500, 0.1],
    [5000, 0.05],
    [190000, 0.01],
    [Infinity, 0.005],
  ];
  let rest = hoofdsom;
  let total = 0;
  for (const [size, pct] of brackets) {
    const part = Math.min(rest, size);
    total += part * pct;
    rest -= part;
    if (rest <= 0) break;
  }
  return Math.round(Math.min(Math.max(total, 40), 6775) * 100) / 100;
}

const party = (prefix: string, title: string, kvk = true): { title: string; fields: Field[] } => ({
  title,
  fields: [
    { name: `${prefix}_naam`, label: "Naam", type: "text", required: true },
    { name: `${prefix}_adres`, label: "Adres en woonplaats / vestigingsplaats", type: "text", required: true },
    ...(kvk
      ? [
          { name: `${prefix}_kvk`, label: "KvK-nummer (indien van toepassing)", type: "text" } as Field,
          { name: `${prefix}_vertegenwoordiger`, label: "Vertegenwoordigd door (indien rechtspersoon)", type: "text" } as Field,
        ]
      : []),
  ],
});

function partyLine(v: Values, prefix: string, role: string) {
  const kvk = v[`${prefix}_kvk`]?.trim() ? `, ingeschreven in het Handelsregister onder nummer ${v[`${prefix}_kvk`].trim()}` : "";
  const rep = v[`${prefix}_vertegenwoordiger`]?.trim() ? `, hierbij rechtsgeldig vertegenwoordigd door ${v[`${prefix}_vertegenwoordiger`].trim()}` : "";
  return `${blank(v[`${prefix}_naam`], "[naam]")}, gevestigd/wonende te ${blank(v[`${prefix}_adres`], "[adres]")}${kvk}${rep}, hierna: "${role}"`;
}

const signing: { title: string; fields: Field[] } = {
  title: "Ondertekening",
  fields: [
    { name: "plaats", label: "Plaats van ondertekening", type: "text" },
    { name: "datum", label: "Datum van ondertekening", type: "date" },
  ],
};

const signLine = (v: Values) => `Aldus overeengekomen en in tweevoud ondertekend te ${blank(v.plaats, "[plaats]")} op ${fmtDate(v.datum)}.`;

// ---------- templates ----------

const ARBEID: Clauses = {
  functie: { label: "Functie en plaats van de werkzaamheden", text: "Werknemer treedt met ingang van {{ingangsdatum}} in dienst van Werkgever in de functie van {{functie}}. De werkzaamheden worden in hoofdzaak verricht te {{standplaats}}. Werknemer verricht daarnaast andere passende werkzaamheden die redelijkerwijs van hem kunnen worden verlangd." },
  duur_bepaald: { label: "Duur – bepaalde tijd", text: "Deze arbeidsovereenkomst wordt aangegaan voor bepaalde tijd en eindigt van rechtswege op {{einddatum}}, zonder dat opzegging is vereist. Tussentijdse opzegging is voor beide partijen mogelijk met inachtneming van de wettelijke opzegtermijn (artikel 7:667 lid 3 BW). Werkgever informeert Werknemer overeenkomstig artikel 7:668 BW tijdig over het al dan niet voortzetten van de arbeidsovereenkomst." },
  duur_onbepaald: { label: "Duur – onbepaalde tijd", text: "Deze arbeidsovereenkomst wordt aangegaan voor onbepaalde tijd." },
  proeftijd: { label: "Proeftijd", text: "Partijen komen een proeftijd overeen van {{proeftijd}}, die voor beide partijen gelijk is (artikel 7:652 BW). Gedurende de proeftijd kan ieder van partijen de arbeidsovereenkomst met onmiddellijke ingang opzeggen." },
  geen_proeftijd: { label: "Proeftijd – geen", text: "Partijen komen geen proeftijd overeen." },
  arbeidsduur: { label: "Arbeidsduur", text: "De arbeidsduur bedraagt {{uren}} uur per week. De werktijden {{werktijden}}, met inachtneming van de Arbeidstijdenwet." },
  werkpatroon_onvoorspelbaar: { label: "Werkpatroon – onvoorspelbaar", text: "Het werkpatroon van Werknemer is geheel of grotendeels onvoorspelbaar. Werknemer is alleen verplicht te werken op de volgende referentiedagen en -uren: {{referentie}} (artikel 7:655 lid 1 BW)." },
  overwerk_vergoed: { label: "Overwerk – vergoed", text: "Overwerk is arbeid boven de overeengekomen arbeidsduur, op verzoek van Werkgever. Werkgever vergoedt overwerk tegen {{overwerk_pct}}% van het bruto uurloon." },
  overwerk_tijd: { label: "Overwerk – compensatie in tijd", text: "Overwerk is arbeid boven de overeengekomen arbeidsduur, op verzoek van Werkgever. Overwerk wordt gecompenseerd in vrije tijd, in overleg op te nemen." },
  overwerk_inbegrepen: { label: "Overwerk – inbegrepen in salaris", text: "Overwerk is arbeid boven de overeengekomen arbeidsduur, op verzoek van Werkgever. Een vergoeding voor overwerk is in het salaris inbegrepen." },
  vergoedingen: { label: "Vergoedingen", text: "Werkgever vergoedt aan Werknemer: {{vergoedingen}}." },
  arbeidsduur_oproep: { label: "Arbeidsduur – oproepovereenkomst", text: "Werknemer werkt op oproepbasis. De arbeidsduur bedraagt ten minste {{min_uren}} en ten hoogste {{uren}} uur per week. Werkgever roept Werknemer ten minste vier dagen van tevoren schriftelijk of elektronisch op; bij een kortere oproeptermijn is Werknemer niet verplicht gehoor te geven. Bij een oproep voor minder dan drie uur heeft Werknemer onder de voorwaarden van artikel 7:628a lid 1 BW recht op loon over drie uur. Na twaalf maanden doet Werkgever binnen een maand een aanbod voor een vaste arbeidsomvang van ten minste het gemiddelde over de voorgaande twaalf maanden (artikel 7:628a BW)." },
  salaris: { label: "Salaris en vakantiebijslag", text: "Het bruto salaris bedraagt {{salaris}} per maand bij de overeengekomen arbeidsduur, te betalen {{betaaldag}}. Werknemer heeft recht op een vakantiebijslag van {{vakantiebijslag}}% van het bruto salaris, die jaarlijks in de maand {{vakantiebijslag_maand}} wordt uitbetaald." },
  vakantie: { label: "Vakantie", text: "Werknemer heeft recht op {{vakantiedagen}} vakantiedagen per kalenderjaar met behoud van salaris, naar rato van de arbeidsduur. Het wettelijke deel van de vakantiedagen vervalt zes maanden na het jaar van opbouw, tenzij Werknemer redelijkerwijs niet in staat is geweest vakantie op te nemen (artikel 7:640a BW)." },
  ziekte: { label: "Arbeidsongeschiktheid", text: "Bij arbeidsongeschiktheid wegens ziekte meldt Werknemer zich overeenkomstig de verzuimvoorschriften van Werkgever. Werkgever betaalt het loon door overeenkomstig artikel 7:629 BW." },
  ziekte_aangepast: { label: "Arbeidsongeschiktheid – eigen percentages", text: "Bij arbeidsongeschiktheid wegens ziekte meldt Werknemer zich overeenkomstig de verzuimvoorschriften van Werkgever. Werkgever betaalt in het eerste ziektejaar {{ziekte_jaar1}}% en in het tweede ziektejaar {{ziekte_jaar2}}% van het loon door, met inachtneming van artikel 7:629 BW." },
  geheimhouding: { label: "Geheimhouding", text: "Werknemer is verplicht, zowel tijdens als na afloop van de arbeidsovereenkomst, geheimhouding te betrachten ten aanzien van alle vertrouwelijke informatie betreffende Werkgever en diens relaties waarvan hij kennis neemt in het kader van zijn werkzaamheden." },
  nevenwerkzaamheden_beperkt: { label: "Nevenwerkzaamheden – met toestemming", text: "Werknemer verricht geen arbeid voor anderen zonder voorafgaande schriftelijke toestemming van Werkgever. Werkgever weigert die toestemming uitsluitend op grond van een objectieve rechtvaardigingsgrond, te weten: {{nevenwerk_reden}} (artikel 7:653a BW)." },
  nevenwerkzaamheden: { label: "Nevenwerkzaamheden", text: "Werknemer mag naast zijn werkzaamheden voor Werkgever arbeid voor anderen verrichten. Werkgever kan dit uitsluitend verbieden of beperken op grond van een objectieve rechtvaardigingsgrond, zoals de bescherming van de gezondheid en veiligheid, de vertrouwelijkheid van bedrijfsinformatie, de integriteit van de dienst of het voorkomen van belangenconflicten (artikel 7:653a BW)." },
  scholing: { label: "Scholing", text: "Werkgever stelt Werknemer in staat scholing te volgen die noodzakelijk is voor de uitoefening van zijn functie. Scholing die Werkgever op grond van de wet of een cao verplicht moet aanbieden, is voor Werknemer kosteloos, geldt als arbeidstijd en vindt voor zover mogelijk plaats onder werktijd (artikel 7:611a BW)." },
  concurrentiebeding: { label: "Concurrentiebeding", text: "Het is Werknemer niet toegestaan gedurende {{concurrentie_duur}} maanden na het einde van deze arbeidsovereenkomst, binnen {{concurrentie_gebied}}, direct of indirect werkzaam te zijn bij of voor een onderneming die gelijke of soortgelijke werkzaamheden verricht als Werkgever (artikel 7:653 BW)." },
  relatiebeding: { label: "Relatiebeding", text: "Het is Werknemer niet toegestaan gedurende {{relatie_duur}} maanden na het einde van deze arbeidsovereenkomst, direct of indirect zakelijke contacten te onderhouden met relaties van Werkgever met wie Werknemer in het jaar voor het einde van de arbeidsovereenkomst zakelijk contact heeft gehad (artikel 7:653 BW)." },
  concurrentie_motivering: { label: "Concurrentie-/relatiebeding – motivering (bepaalde tijd)", text: "Motivering van de zwaarwegende bedrijfs- of dienstbelangen (artikel 7:653 lid 2 BW): {{concurrentie_motivering}}" },
  opzegging: { label: "Opzegging", text: "Opzegging geschiedt schriftelijk tegen het einde van de maand. Voor Werkgever geldt de opzegtermijn van artikel 7:672 lid 2 BW en voor Werknemer een opzegtermijn van één maand (artikel 7:672 lid 4 BW)." },
  opzegging_verlengd: { label: "Opzegging – verlengde termijn werknemer", text: "Opzegging geschiedt schriftelijk tegen het einde van de maand. Voor Werknemer geldt een opzegtermijn van {{opzeg_wn}}. Voor Werkgever geldt de opzegtermijn van artikel 7:672 lid 2 BW, maar ten minste {{opzeg_wg}} (artikel 7:672 lid 6 BW)." },
  cao: { label: "Cao", text: "Op deze arbeidsovereenkomst is de {{cao}} van toepassing." },
  geen_cao: { label: "Cao – geen", text: "Op deze arbeidsovereenkomst is geen collectieve arbeidsovereenkomst van toepassing." },
  pensioen: { label: "Pensioen", text: "Werknemer neemt deel aan de pensioenregeling: {{pensioen}}." },
  geen_pensioen: { label: "Pensioen – geen", text: "Werkgever heeft geen pensioenregeling getroffen." },
  slot: { label: "Slotbepalingen", text: "Op deze arbeidsovereenkomst is Nederlands recht van toepassing. Deze overeenkomst geldt tevens als schriftelijke opgave als bedoeld in artikel 7:655 BW, voor zover de daarin vereiste gegevens hierin zijn opgenomen. Wijzigingen zijn slechts geldig indien schriftelijk overeengekomen." },
};

const HUUR: Clauses = {
  gehuurde: { label: "Het gehuurde", text: "Verhuurder verhuurt aan Huurder, die in huur aanneemt, de zelfstandige woonruimte gelegen aan {{object_adres}}{{bestaande_uit}}, hierna: \"het gehuurde\". Het gehuurde is uitsluitend bestemd om te worden gebruikt als woonruimte voor Huurder en diens huishouden." },
  duur_bepaald: { label: "Duur – bepaalde tijd", text: "Deze overeenkomst is aangegaan voor bepaalde tijd, ingaande op {{ingangsdatum}} en eindigend op {{einddatum}}, op grond van artikel 7:271 lid 2 BW. Huurder behoort tot de categorie: {{categorie}}. Verhuurder informeert Huurder niet eerder dan drie maanden en uiterlijk één maand voor de einddatum schriftelijk over de dag waarop de huur eindigt. Huurder kan de huur tussentijds opzeggen tegen een voor betaling van de huurprijs overeengekomen dag." },
  duur_onbepaald: { label: "Duur – onbepaalde tijd", text: "Deze overeenkomst is aangegaan voor onbepaalde tijd, ingaande op {{ingangsdatum}}." },
  huurprijs: { label: "Huurprijs en servicekosten", text: "De kale huurprijs bedraagt {{kale_huur}} per maand. Daarnaast betaalt Huurder een voorschot op de servicekosten van {{servicekosten}} per maand. Het totaal per maand bedraagt {{totaal}}.{{servicekosten_spec}} Verhuurder verstrekt jaarlijks een overzicht van de werkelijke servicekosten (artikel 7:259 BW)." },
  huurverhoging_opslag: { label: "Huurverhoging – CPI plus opslag", text: "De huurprijs kan jaarlijks per 1 juli worden verhoogd met het percentage van de wijziging van het consumentenprijsindexcijfer (CPI, alle huishoudens) van het CBS over het voorgaande kalenderjaar. Daarnaast kan de huurprijs worden verhoogd met een opslag van ten hoogste {{opslag}}%. De opslag is een afzonderlijk beding en geldt alleen voor zover de totale verhoging binnen de op dat moment wettelijk toegestane maximale huurverhoging blijft. Verhuurder doet Huurder daartoe uiterlijk twee maanden voor de ingangsdatum een schriftelijk voorstel (artikelen 7:248 en 7:252 BW)." },
  huurverhoging_geen: { label: "Huurverhoging – geen indexatiebeding", text: "Partijen komen geen indexatiebeding overeen. De huurprijs kan alleen worden gewijzigd met instemming van Huurder of voor zover de wet dat toestaat." },
  huurverhoging: { label: "Huurverhoging", text: "De huurprijs kan jaarlijks per 1 juli worden verhoogd met ten hoogste het percentage van de wijziging van het consumentenprijsindexcijfer (CPI, alle huishoudens) van het CBS over het voorgaande kalenderjaar, en in geen geval met meer dan de op dat moment wettelijk toegestane maximale huurverhoging. Verhuurder doet Huurder daartoe uiterlijk twee maanden voor de ingangsdatum een schriftelijk voorstel (artikelen 7:248 en 7:252 BW)." },
  betaling: { label: "Betaling", text: "De huurprijs en het voorschot servicekosten zijn per maand vooruit verschuldigd en dienen {{betaaldag}} te zijn voldaan{{op_rekening}}." },
  huisdieren_toegestaan: { label: "Huisdieren – toegestaan", text: "Het houden van huisdieren in het gehuurde is toegestaan, mits deze geen overlast of schade veroorzaken." },
  huisdieren_niet: { label: "Huisdieren – niet toegestaan", text: "Het houden van huisdieren in het gehuurde is niet toegestaan." },
  huisdieren_toestemming: { label: "Huisdieren – met toestemming", text: "Het houden van huisdieren in het gehuurde is alleen toegestaan met voorafgaande schriftelijke toestemming van Verhuurder, die niet op onredelijke gronden wordt geweigerd." },
  inventaris: { label: "Inventaris", text: "Het gehuurde wordt gemeubileerd verhuurd. De meegehuurde inventaris is beschreven in een door partijen ondertekende inventarislijst, die deel uitmaakt van deze overeenkomst." },
  waarborgsom: { label: "Waarborgsom", text: "Huurder betaalt bij aanvang een waarborgsom van {{waarborgsom}}. De waarborgsom bedraagt ten hoogste tweemaal de kale huurprijs. Verhuurder restitueert de waarborgsom binnen veertien dagen na beëindiging van de huurovereenkomst, dan wel binnen dertig dagen in de gevallen van artikel 7:261b lid 3 BW, na verrekening van aantoonbare kosten met volledige kostenspecificatie." },
  gebruik: { label: "Gebruik en onderhoud", text: "Huurder gebruikt het gehuurde als een goed huurder. Kleine herstellingen als bedoeld in artikel 7:240 BW en het Besluit kleine herstellingen komen voor rekening van Huurder. Overige gebreken worden op verzoek van Huurder door Verhuurder verholpen (artikel 7:206 BW). {{onderhuur}}" },
  opzegging: { label: "Opzegging", text: "Opzegging geschiedt bij exploot of aangetekende brief (artikel 7:271 lid 4 BW). Huurder neemt een opzegtermijn in acht van ten minste één maand. Verhuurder kan uitsluitend opzeggen op een van de gronden van artikel 7:274 lid 1 BW, met vermelding van die gronden, en neemt een opzegtermijn in acht van drie maanden, verlengd met één maand voor elk jaar dat Huurder het gehuurde ononderbroken in gebruik heeft gehad, tot ten hoogste zes maanden." },
  oplevering: { label: "Oplevering", text: "Bij het einde van de huur levert Huurder het gehuurde op in de staat waarin hij het bij aanvang heeft ontvangen, met uitzondering van normale slijtage (artikel 7:224 BW). Partijen stellen bij aanvang een beschrijving van het gehuurde op." },
  informatie: { label: "Informatie aan Huurder", text: "Verhuurder heeft Huurder uiterlijk bij het aangaan van deze overeenkomst schriftelijk geïnformeerd over de rechten en verplichtingen van huurder en verhuurder, de hoogte en terugbetaling van de waarborgsom, de servicekosten, de contactgegevens van Verhuurder en het gemeentelijk meldpunt{{meldpunt}}, zoals voorgeschreven door de Wet goed verhuurderschap." },
  recht: { label: "Toepasselijk recht", text: "Op deze overeenkomst is Nederlands recht van toepassing. Afwijkingen ten nadele van Huurder van dwingendrechtelijke bepalingen van afdeling 7.4.5 BW zijn nietig." },
};

const NDA: Clauses = {
  informatie: { label: "Vertrouwelijke informatie", text: "Onder vertrouwelijke informatie wordt verstaan alle informatie, in welke vorm ook, die {{verstrekker}} in verband met het Doel verstrekt, waaronder bedrijfsgeheimen als bedoeld in de Wet bescherming bedrijfsgeheimen, met uitzondering van informatie die (a) algemeen bekend is of wordt zonder schending van deze overeenkomst, (b) aantoonbaar reeds rechtmatig in bezit was van {{ontvanger}}, of (c) rechtmatig van een derde is verkregen zonder geheimhoudingsplicht." },
  verplichtingen: { label: "Verplichtingen", text: "{{Ontvanger}} zal de vertrouwelijke informatie (a) uitsluitend gebruiken voor het Doel, (b) niet aan derden verstrekken, behoudens aan werknemers en adviseurs die de informatie voor het Doel nodig hebben en aan een gelijkwaardige geheimhoudingsplicht zijn gebonden, en (c) passende maatregelen treffen om de informatie te beveiligen." },
  wettelijk: { label: "Wettelijke verplichting", text: "Indien {{ontvanger}} op grond van de wet of een rechterlijke uitspraak verplicht is vertrouwelijke informatie openbaar te maken, stelt zij de andere Partij hiervan voorafgaand en onverwijld op de hoogte, voor zover wettelijk toegestaan." },
  duur: { label: "Duur", text: "Deze overeenkomst treedt in werking op de datum van ondertekening. De geheimhoudingsplicht geldt gedurende de samenwerking en {{duur}} jaar na beëindiging daarvan." },
  teruggave: { label: "Teruggave", text: "{{teruggave}} retourneert of vernietigt {{ontvanger}} alle vertrouwelijke informatie en kopieën daarvan en bevestigt dit schriftelijk." },
  boete: { label: "Boete", text: "Bij overtreding van deze overeenkomst verbeurt de overtredende Partij, zonder dat ingebrekestelling is vereist, aan de andere Partij een direct opeisbare boete van {{boete}} per overtreding, vermeerderd met {{boete_dag}} voor iedere dag dat de overtreding voortduurt. De boete laat het recht onverlet om nakoming en volledige schadevergoeding te vorderen (in afwijking van artikel 6:92 lid 2 BW)." },
  boete_plaats: { label: "Boete – in plaats van schadevergoeding", text: "Bij overtreding van deze overeenkomst verbeurt de overtredende Partij, zonder dat ingebrekestelling is vereist, aan de andere Partij een direct opeisbare boete van {{boete}} per overtreding, vermeerderd met {{boete_dag}} voor iedere dag dat de overtreding voortduurt. De boete treedt in de plaats van schadevergoeding (artikel 6:92 lid 2 BW); het recht om nakoming te vorderen blijft onverlet." },
  boete_werknemer: { label: "Boete – Partij 2 is werknemer", text: "Partij 2 is werknemer van Partij 1. Voor zover het loon van Partij 2 hoger is dan het wettelijk minimumloon, komt de boete in afwijking van artikel 7:650 leden 3 tot en met 5 BW ten goede aan Partij 1 (artikel 7:650 lid 6 BW). Is het loon niet hoger dan het minimumloon, dan gelden de beperkingen van artikel 7:650 BW onverkort." },
  forum: { label: "Toepasselijk recht en forum", text: "Op deze overeenkomst is Nederlands recht van toepassing. Geschillen worden in eerste aanleg exclusief voorgelegd aan de {{rechtbank}}." },
  forum_mediation: { label: "Toepasselijk recht en forum – eerst mediation", text: "Op deze overeenkomst is Nederlands recht van toepassing. Partijen trachten een geschil eerst door mediation op te lossen. Leidt mediation niet binnen twee maanden tot een oplossing, dan wordt het geschil in eerste aanleg exclusief voorgelegd aan de {{rechtbank}}." },
  forum_arbitrage: { label: "Toepasselijk recht en forum – arbitrage", text: "Op deze overeenkomst is Nederlands recht van toepassing. Geschillen worden beslecht door arbitrage overeenkomstig het Arbitragereglement van het Nederlands Arbitrage Instituut. De plaats van arbitrage is {{arbitrage_plaats}}." },
};

const VOLMACHT: Clauses = {
  omvang: { label: "Omvang – inleiding", text: "om in naam van Volmachtgever de volgende rechtshandelingen te verrichten (artikel 3:60 BW):" },
  omvang_algemeen: { label: "Omvang – algemene volmacht", text: "om in naam van Volmachtgever alle daden van beheer te verrichten (artikel 3:62 lid 2 BW), alsmede de volgende rechtshandelingen (artikel 3:60 BW):" },
  selbsteintritt: { label: "Tegenstrijdig belang (Selbsteintritt)", text: "Gevolmachtigde is bevoegd om bij het verrichten van deze rechtshandelingen tevens als wederpartij van Volmachtgever of als gevolmachtigde van de wederpartij op te treden (artikel 3:68 BW)." },
  bevoegdheid: { label: "Omvang – bevoegdheden", text: "Gevolmachtigde is bevoegd daartoe alle stukken te ondertekenen, verklaringen af te leggen en in ontvangst te nemen, en voorts al datgene te doen wat voor het verrichten van deze rechtshandelingen nodig of dienstig is." },
  substitutie: { label: "Substitutie – toegestaan", text: "Gevolmachtigde is bevoegd deze volmacht geheel of gedeeltelijk aan een ander te verlenen (artikel 3:64 BW)." },
  geen_substitutie: { label: "Substitutie – niet toegestaan", text: "Gevolmachtigde is niet bevoegd deze volmacht aan een ander te verlenen, behoudens in de gevallen van artikel 3:64 BW." },
  duur_tot: { label: "Duur – tot datum", text: "Deze volmacht is geldig tot en met {{geldig_tot}}, onverminderd het bepaalde in artikel 3:72 BW." },
  duur_herroeping: { label: "Duur – tot herroeping", text: "Deze volmacht geldt tot herroeping door Volmachtgever, onverminderd het bepaalde in artikel 3:72 BW." },
  duur_onherroepelijk: { label: "Duur – onherroepelijk, zonder einddatum", text: "Deze volmacht geldt totdat de rechtshandelingen zijn verricht, onverminderd het bepaalde in artikel 3:72 BW." },
  onherroepelijk: { label: "Onherroepelijkheid", text: "Deze volmacht is onherroepelijk, omdat zij strekt tot het verrichten van rechtshandelingen in het belang van {{belang}} (artikel 3:74 lid 1 BW)." },
  recht: { label: "Toepasselijk recht", text: "Op deze volmacht is Nederlands recht van toepassing." },
  legalisatie: { label: "Legalisatie handtekening", text: "Volmachtgever laat zijn handtekening onder deze volmacht legaliseren door een notaris." },
};

const AANMANING: Clauses = {
  aanhef: { label: "Aanhef", text: "Geachte heer/mevrouw," },
  vordering: { label: "Vordering", text: "Op {{factuurdatum}} heeft {{sch_naam}} u factuur {{factuurnummer}} gezonden{{voor_omschrijving}}, met als uiterste betaaldatum {{vervaldatum}}. Uit onze administratie blijkt dat een bedrag van {{hoofdsom}} nog niet is voldaan." },
  sommatie_consument: { label: "Sommatie – consument", text: "Wij verzoeken en sommeren u het openstaande bedrag van {{hoofdsom}} binnen {{termijn}} dagen, te rekenen vanaf de dag na ontvangst van deze brief, te voldoen op rekeningnummer {{iban}} onder vermelding van het factuurnummer." },
  sommatie_zakelijk: { label: "Sommatie – onderneming", text: "Wij verzoeken en sommeren u het openstaande bedrag van {{hoofdsom}} binnen {{termijn}} dagen na dagtekening van deze brief{{uiterlijk_op}}, te voldoen op rekeningnummer {{iban}} onder vermelding van het factuurnummer." },
  verzuim_consument: { label: "Verzuim en rente – consument", text: "Indien betaling binnen deze termijn uitblijft, verkeert u in verzuim (artikel 6:82 lid 1 BW) en bent u vanaf dat moment tevens de wettelijke rente (artikel 6:119 BW), thans {{rente}} per jaar, verschuldigd." },
  verzuim_zakelijk: { label: "Verzuim en rente – onderneming", text: "Indien betaling binnen deze termijn uitblijft, verkeert u in verzuim (artikel 6:82 lid 1 BW) en bent u vanaf dat moment tevens de wettelijke handelsrente (artikel 6:119a BW), thans {{rente}} per jaar, vanaf de vervaldatum verschuldigd." },
  kosten_consument: { label: "Incassokosten – consument", text: "Betaalt u niet binnen de genoemde termijn, dan bent u daarnaast buitengerechtelijke incassokosten verschuldigd van {{incassokosten}}, berekend overeenkomstig het Besluit vergoeding voor buitengerechtelijke incassokosten (artikel 6:96 lid 5 en 6 BW). Wij zullen de vordering dan zonder nadere aankondiging ter incasso uit handen geven, waarbij ook gerechtelijke stappen tot de mogelijkheden behoren." },
  kosten_zakelijk: { label: "Incassokosten – onderneming", text: "Daarnaast bent u buitengerechtelijke incassokosten verschuldigd van {{incassokosten}}, berekend overeenkomstig het Besluit vergoeding voor buitengerechtelijke incassokosten (artikel 6:96 BW). Blijft betaling uit, dan zullen wij zonder nadere aankondiging rechtsmaatregelen treffen." },
  slot: { label: "Slot", text: "Heeft u het bedrag inmiddels voldaan, dan kunt u deze brief als niet verzonden beschouwen. Voor vragen kunt u contact met ons opnemen{{via_contact}}." },
  groet: { label: "Groet", text: "Hoogachtend," },
};

const VSO: Clauses = {
  overweging_a: { label: "Overweging a – dienstverband", text: "a. Werknemer sinds {{indienst}} bij Werkgever in dienst is{{in_functie}}{{met_salaris}};" },
  overweging_b: { label: "Overweging b – initiatief werkgever", text: "b. Werkgever het initiatief heeft genomen tot beëindiging van de arbeidsovereenkomst in verband met: {{reden}};" },
  overweging_c: { label: "Overweging c – geen dringende reden", text: "c. van een dringende reden als bedoeld in artikel 7:678 BW geen sprake is en Werknemer geen verwijt kan worden gemaakt;" },
  overweging_ziekte: { label: "Overweging d – niet arbeidsongeschikt", text: "d. Werknemer op de datum van ondertekening niet arbeidsongeschikt is wegens ziekte en er geen opzegverbod geldt;" },
  overweging_d: { label: "Overweging e – wederzijds goedvinden", text: "e. partijen de arbeidsovereenkomst met wederzijds goedvinden wensen te beëindigen en de gevolgen daarvan wensen vast te leggen in deze vaststellingsovereenkomst als bedoeld in artikel 7:900 BW;" },
  einde: { label: "Einde arbeidsovereenkomst", text: "De arbeidsovereenkomst eindigt met wederzijds goedvinden op {{einddatum}} (hierna: \"de einddatum\"), met inachtneming van de voor Werkgever geldende opzegtermijn." },
  vrijstelling: { label: "Vrijstelling van werk – ja", text: "Werknemer wordt met ingang van de datum van ondertekening tot de einddatum vrijgesteld van werkzaamheden, met behoud van salaris en emolumenten. Werknemer blijft beschikbaar voor een correcte overdracht." },
  geen_vrijstelling: { label: "Vrijstelling van werk – nee", text: "Werknemer blijft tot de einddatum zijn werkzaamheden verrichten." },
  vergoeding_apart: { label: "Beëindigingsvergoeding – naast transitievergoeding", text: "Werkgever betaalt aan Werknemer de wettelijke transitievergoeding als bedoeld in artikel 7:673 BW en daarnaast een bruto beëindigingsvergoeding van {{vergoeding}}, beide {{betaaltermijn}}, te verminderen met de wettelijk verplichte inhoudingen." },
  vergoeding: { label: "Beëindigingsvergoeding", text: "Werkgever betaalt aan Werknemer een bruto beëindigingsvergoeding van {{vergoeding}}, {{betaaltermijn}}, te verminderen met de wettelijk verplichte inhoudingen. Deze vergoeding strekt tevens ter voldoening aan de transitievergoeding als bedoeld in artikel 7:673 BW." },
  eindafrekening: { label: "Eindafrekening", text: "Werkgever stelt uiterlijk binnen een maand na de einddatum een eindafrekening op, waarin onder meer de openstaande vakantiedagen{{vakantiedagen}} en de opgebouwde vakantiebijslag worden uitbetaald (artikel 7:641 BW).{{bonus}}" },
  kosten: { label: "Juridische kosten", text: "Werkgever vergoedt de kosten van juridische bijstand van Werknemer tot een maximum van {{advocaatkosten}} exclusief btw, na ontvangst van een op Werkgever gestelde factuur." },
  concurrentie_vervalt: { label: "Concurrentie- en relatiebeding – vervalt", text: "Het tussen partijen overeengekomen concurrentie- en/of relatiebeding komt met ingang van de einddatum te vervallen." },
  concurrentie_blijft: { label: "Concurrentie- en relatiebeding – blijft", text: "Het tussen partijen overeengekomen concurrentie- en/of relatiebeding blijft na de einddatum onverkort van kracht." },
  getuigschrift: { label: "Getuigschrift en bedrijfseigendommen", text: "{{getuigschrift}} Werknemer levert uiterlijk op de einddatum {{eigendommen}} in." },
  studiekosten: { label: "Studiekosten", text: "Werkgever ziet af van terugbetaling van studiekosten die Werknemer op grond van een eerder overeengekomen studiekostenbeding verschuldigd zou zijn." },
  bedenktermijn: { label: "Bedenktermijn", text: "Werknemer heeft het recht deze overeenkomst zonder opgave van redenen binnen veertien dagen na de datum waarop deze tot stand is gekomen, door een schriftelijke aan Werkgever gerichte verklaring te ontbinden (artikel 7:670b lid 2 BW)." },
  kwijting: { label: "Finale kwijting", text: "Met de uitvoering van deze overeenkomst verlenen partijen elkaar over en weer finale kwijting ter zake van al hetgeen zij uit hoofde van de arbeidsovereenkomst en de beëindiging daarvan van elkaar te vorderen hebben, behoudens de verplichtingen uit deze overeenkomst." },
  recht: { label: "Toepasselijk recht", text: "Op deze overeenkomst is Nederlands recht van toepassing." },
};

const arbeidsovereenkomst: Template = {
  id: "arbeidsovereenkomst",
  title: "Arbeidsovereenkomst",
  description: "Arbeidsovereenkomst voor bepaalde of onbepaalde tijd (titel 7.10 BW).",
  sources: [art(7, "610"), art(7, "611a"), art(7, "628a"), art(7, "652"), art(7, "653"), art(7, "653a"), art(7, "655"), art(7, "668"), art(7, "668a"), art(7, "672"), art(7, "634"), law("Wet minimumloon en minimumvakantiebijslag", "BWBR0002638")],
  rules: [
    "Proeftijd: schriftelijk en voor beide partijen gelijk; geen proeftijd bij een overeenkomst van ten hoogste zes maanden; ten hoogste één maand bij bepaalde tijd korter dan twee jaar; ten hoogste twee maanden bij bepaalde tijd van twee jaar of langer en bij onbepaalde tijd (art. 7:652 BW).",
    "Concurrentiebeding: alleen schriftelijk en met een meerderjarige werknemer; in een overeenkomst voor bepaalde tijd alleen met een schriftelijke motivering van zwaarwegende bedrijfs- of dienstbelangen (art. 7:653 BW).",
    "Nevenwerkzaamheden mogen alleen worden verboden of beperkt op grond van een objectieve rechtvaardigingsgrond (art. 7:653a BW).",
    "Scholing die de werkgever verplicht moet aanbieden is kosteloos voor de werknemer en geldt als arbeidstijd (art. 7:611a BW).",
    "Bij bepaalde tijd van zes maanden of langer geldt de aanzegverplichting (art. 7:668 BW). Na meer dan drie opeenvolgende contracten of meer dan 36 maanden ontstaat een overeenkomst voor onbepaalde tijd (art. 7:668a BW).",
    "Oproepovereenkomst: oproeptermijn van ten minste vier dagen, loon over minimaal drie uur per oproep onder de voorwaarden van art. 7:628a lid 1 BW, en na twaalf maanden een aanbod voor een vaste arbeidsomvang (art. 7:628a BW).",
    "Een langere opzegtermijn voor de werknemer kan alleen schriftelijk, ten hoogste zes maanden, en de termijn voor de werkgever is dan ten minste het dubbele (art. 7:672 lid 6 BW).",
    `Het salaris bedraagt ten minste het wettelijk minimumloon (per 1 juli 2026 € ${WML_UUR.toFixed(2).replace(".", ",")} per uur vanaf 21 jaar; lagere jeugdbedragen daaronder).`,
    "Vakantie: ten minste vier maal de wekelijkse arbeidsduur (art. 7:634 BW).",
    "De overeenkomst bevat de gegevens die art. 7:655 BW voorschrijft, of die worden apart schriftelijk verstrekt.",
  ],
  groups: [
    party("wg", "Werkgever"),
    { title: "Werknemer", fields: [
      { name: "wn_naam", label: "Naam", type: "text", required: true },
      { name: "wn_adres", label: "Adres en woonplaats", type: "text", required: true },
      { name: "wn_geboortedatum", label: "Geboortedatum", type: "date" },
    ] },
    { title: "Functie en duur", fields: [
      { name: "functie", label: "Functie", type: "text", required: true },
      { name: "standplaats", label: "Plaats van de werkzaamheden", type: "text" },
      { name: "ingangsdatum", label: "Datum indiensttreding", type: "date", required: true },
      { name: "duur", label: "Duur", type: "select", default: "onbepaald", options: [
        { value: "onbepaald", label: "Onbepaalde tijd" },
        { value: "bepaald", label: "Bepaalde tijd" },
      ] },
      { name: "einddatum", label: "Einddatum", type: "date", showIf: (v) => v.duur === "bepaald" },
      { name: "eerdere_contracten", label: "Aantal eerdere contracten met deze werknemer (ketenregeling)", type: "number", default: "0", showIf: (v) => v.duur === "bepaald" },
      { name: "eerdere_maanden", label: "Totale duur eerdere contracten (maanden)", type: "number", default: "0", showIf: (v) => v.duur === "bepaald" },
      { name: "proeftijd", label: "Proeftijd", type: "select", default: "geen", options: [
        { value: "geen", label: "Geen proeftijd" },
        { value: "1", label: "1 maand" },
        { value: "2", label: "2 maanden" },
      ], discouraged: (o, v) => {
        // art. 7:652 BW; unknown duration discourages nothing.
        const m = v.duur === "bepaald" && v.ingangsdatum && v.einddatum ? monthsBetween(v.ingangsdatum, v.einddatum) : NaN;
        return o !== "geen" && !isNaN(m) && (o === "1" ? m <= 6 : m < 24);
      } },
    ] },
    { title: "Arbeidsvoorwaarden", fields: [
      { name: "contractsoort", label: "Soort contract", type: "select", default: "vast", options: [
        { value: "vast", label: "Vaste arbeidsduur" },
        { value: "oproep", label: "Oproepovereenkomst (min-max of nul-uren)" },
      ] },
      { name: "min_uren", label: "Minimum uren per week (0 = nul-urencontract)", type: "number", default: "0", showIf: (v) => v.contractsoort === "oproep" },
      { name: "uren", label: "Arbeidsduur (uren per week; bij oproep: maximum)", type: "number", default: "40" },
      { name: "salaris", label: "Bruto salaris per maand (€)", type: "number" },
      { name: "vakantiedagen", label: "Vakantiedagen per jaar (bij volledige werkweek)", type: "number", default: "25" },
      { name: "cao", label: "Toepasselijke cao (leeg = geen)", type: "text" },
      { name: "pensioen", label: "Pensioenregeling (leeg = geen)", type: "text" },
      { name: "concurrentiebeding", label: "Concurrentiebeding", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
      { name: "concurrentie_duur", label: "Duur concurrentiebeding (maanden)", type: "number", default: "12", showIf: (v) => v.concurrentiebeding === "ja" },
      { name: "concurrentie_gebied", label: "Gebied concurrentiebeding", type: "text", default: "Nederland", showIf: (v) => v.concurrentiebeding === "ja" },
      { name: "relatiebeding", label: "Relatiebeding", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
      { name: "relatie_duur", label: "Duur relatiebeding (maanden)", type: "number", default: "12", showIf: (v) => v.relatiebeding === "ja" },
      { name: "concurrentie_motivering", label: "Schriftelijke motivering zwaarwegende bedrijfsbelangen", type: "textarea", showIf: (v) => (v.concurrentiebeding === "ja" || v.relatiebeding === "ja") && v.duur === "bepaald" },
      { name: "nevenwerk", label: "Nevenwerkzaamheden", type: "select", default: "toegestaan", options: [
        { value: "toegestaan", label: "Toegestaan" },
        { value: "beperkt", label: "Alleen met toestemming (objectieve reden vereist)" },
      ] },
      { name: "nevenwerk_reden", label: "Objectieve rechtvaardigingsgrond voor de beperking", type: "textarea", showIf: (v) => v.nevenwerk === "beperkt" },
      { name: "opzeg_wn", label: "Opzegtermijn werknemer", type: "select", default: "1", options: [
        { value: "1", label: "Eén maand (wettelijk)" },
        { value: "2", label: "Twee maanden" },
        { value: "3", label: "Drie maanden" },
      ] },
    ] },
    { title: "Meer opties", advanced: true, fields: [
      { name: "betaaldag", label: "Betaling salaris", type: "text", default: "uiterlijk op de laatste werkdag van elke maand" },
      { name: "vakantiebijslag", label: "Vakantiebijslag (%)", type: "number", default: "8" },
      { name: "vakantiebijslag_maand", label: "Uitbetaling vakantiebijslag (maand)", type: "text", default: "mei" },
      { name: "werktijden", label: "Werktijden (leeg = in overleg)", type: "text", placeholder: "bijv. maandag t/m vrijdag van 9.00 tot 17.30 uur" },
      { name: "werkpatroon", label: "Werkpatroon", type: "select", default: "voorspelbaar", options: [
        { value: "voorspelbaar", label: "Voorspelbaar" },
        { value: "onvoorspelbaar", label: "Geheel of grotendeels onvoorspelbaar" },
      ] },
      { name: "referentie", label: "Referentiedagen en -uren", type: "textarea", showIf: (v) => v.werkpatroon === "onvoorspelbaar", placeholder: "bijv. maandag t/m zaterdag tussen 8.00 en 20.00 uur" },
      { name: "overwerk", label: "Overwerk", type: "select", default: "", options: [
        { value: "", label: "Niet opnemen" },
        { value: "vergoed", label: "Vergoed tegen een percentage van het uurloon" },
        { value: "tijd", label: "Compensatie in vrije tijd" },
        { value: "inbegrepen", label: "Inbegrepen in het salaris" },
      ] },
      { name: "overwerk_pct", label: "Overwerkvergoeding (% van uurloon)", type: "number", default: "100", showIf: (v) => v.overwerk === "vergoed" },
      { name: "ziekte_jaar1", label: "Loondoorbetaling bij ziekte, eerste jaar (%; leeg = wettelijk)", type: "number" },
      { name: "ziekte_jaar2", label: "Loondoorbetaling bij ziekte, tweede jaar (%; leeg = wettelijk)", type: "number" },
      { name: "vergoedingen", label: "Vergoedingen (leeg = geen bepaling)", type: "textarea", placeholder: "bijv. een reiskostenvergoeding van € 0,23 per kilometer en een thuiswerkvergoeding van € 2,40 per thuiswerkdag" },
    ] },
    signing,
  ],
  checks: (v) => {
    const out: string[] = [];
    const months = v.duur === "bepaald" && v.ingangsdatum && v.einddatum ? monthsBetween(v.ingangsdatum, v.einddatum) : NaN;
    if (v.duur === "bepaald" && !v.einddatum) out.push("Einddatum ontbreekt bij een overeenkomst voor bepaalde tijd.");
    if (v.duur === "bepaald" && !isNaN(months)) {
      if (months <= 6 && v.proeftijd !== "geen") out.push("Geen proeftijd mogelijk bij een overeenkomst van ten hoogste zes maanden (art. 7:652 lid 6 BW). Een nietige proeftijd geldt niet.");
      else if (months < 24 && v.proeftijd === "2") out.push("Bij bepaalde tijd korter dan twee jaar is de proeftijd ten hoogste één maand (art. 7:652 lid 4 sub a BW).");
      if (months >= 6) out.push("Aanzegverplichting: uiterlijk één maand voor de einddatum schriftelijk informeren over (niet) voortzetten (art. 7:668 BW).");
    }
    const uren = num(v.uren);
    const dagen = num(v.vakantiedagen);
    if (!isNaN(dagen) && dagen < 20) out.push("Wettelijk minimum vakantie is vier maal de wekelijkse arbeidsduur; bij een vijfdaagse werkweek 20 dagen (art. 7:634 BW).");
    if (!isNaN(uren) && uren > 60) out.push("Arbeidsduur boven 60 uur per week overschrijdt de maxima van de Arbeidstijdenwet.");
    const beding = v.concurrentiebeding === "ja" || v.relatiebeding === "ja";
    if (beding && v.duur === "bepaald" && !v.concurrentie_motivering?.trim())
      out.push("Een concurrentie- of relatiebeding in een overeenkomst voor bepaalde tijd vereist een schriftelijke motivering van zwaarwegende bedrijfs- of dienstbelangen (art. 7:653 lid 2 BW).");
    if (beding && v.wn_geboortedatum && v.ingangsdatum && monthsBetween(v.wn_geboortedatum, v.ingangsdatum) < 216)
      out.push("Een concurrentie- of relatiebeding kan alleen met een meerderjarige werknemer worden overeengekomen (art. 7:653 lid 1 sub b BW).");
    if (v.nevenwerk === "beperkt" && !v.nevenwerk_reden?.trim())
      out.push("Een beperking van nevenwerkzaamheden vereist een objectieve rechtvaardigingsgrond (art. 7:653a BW).");
    if (v.contractsoort === "oproep" && num(v.min_uren) > uren)
      out.push("Het minimum aantal uren is hoger dan het maximum.");
    if (v.duur === "bepaald") {
      const eerder = num(v.eerdere_contracten) || 0;
      const totaal = (num(v.eerdere_maanden) || 0) + (isNaN(months) ? 0 : months);
      if (eerder >= 3 || totaal > 36)
        out.push(`Ketenregeling: met ${eerder} eerdere contracten en circa ${Math.round(totaal)} maanden in totaal ontstaat een arbeidsovereenkomst voor onbepaalde tijd, tenzij de tussenpoos meer dan zes maanden was (art. 7:668a BW).`);
    }
    if (num(v.vakantiebijslag) < 8)
      out.push("Afgeraden: de wettelijke vakantiebijslag bedraagt ten minste 8% (art. 15 Wet minimumloon en minimumvakantiebijslag).");
    if (num(v.ziekte_jaar1) < 70 || num(v.ziekte_jaar2) < 70)
      out.push("Afgeraden: loondoorbetaling bij ziekte is wettelijk ten minste 70%, in het eerste jaar niet minder dan het minimumloon (art. 7:629 BW).");
    if (v.werkpatroon === "onvoorspelbaar" && !v.referentie?.trim())
      out.push("Vermeld bij een onvoorspelbaar werkpatroon de referentiedagen en -uren (art. 7:655 lid 1 BW).");
    if (!num(v.salaris)) out.push("Salaris ontbreekt. Controleer dat het salaris ten minste het geldende wettelijk minimumloon bedraagt.");
    const wml = (WML_UUR * uren * 52) / 12;
    if (num(v.salaris) > 0 && uren > 0 && num(v.salaris) < wml)
      out.push(`Salaris ligt onder het wettelijk minimumloon voor werknemers vanaf 21 jaar: ${eur(wml)} per maand bij ${uren} uur per week (€ ${WML_UUR.toFixed(2).replace(".", ",")} per uur per 1 juli 2026). Voor jongere werknemers gelden lagere bedragen.`);
    return out;
  },
  clauses: ARBEID,
  render: (v, custom, extra) => {
    const bepaald = v.duur === "bepaald";
    const proef = v.proeftijd === "geen" || !v.proeftijd ? null : v.proeftijd === "1" ? "één maand" : "twee maanden";
    const c = clauseFn(ARBEID, custom, {
      ingangsdatum: fmtDate(v.ingangsdatum),
      functie: blank(v.functie, "[functie]"),
      standplaats: blank(v.standplaats, "[plaats]"),
      einddatum: fmtDate(v.einddatum),
      proeftijd: proef ?? "",
      uren: blank(v.uren, "[aantal]"),
      salaris: eur(v.salaris),
      vakantiedagen: blank(v.vakantiedagen, "[aantal]"),
      concurrentie_duur: blank(v.concurrentie_duur, "[aantal]"),
      concurrentie_motivering: blank(v.concurrentie_motivering, "[motivering]"),
      concurrentie_gebied: blank(v.concurrentie_gebied, "Nederland"),
      relatie_duur: blank(v.relatie_duur, "[aantal]"),
      min_uren: blank(v.min_uren, "0"),
      nevenwerk_reden: blank(v.nevenwerk_reden, "[rechtvaardigingsgrond]"),
      opzeg_wn: ({ "2": "twee maanden", "3": "drie maanden" } as Values)[v.opzeg_wn] ?? "één maand",
      opzeg_wg: ({ "2": "vier maanden", "3": "zes maanden" } as Values)[v.opzeg_wn] ?? "",
      cao: v.cao?.trim() ?? "",
      pensioen: v.pensioen?.trim() ?? "",
      werktijden: v.werktijden?.trim() ? `zijn: ${v.werktijden.trim()}` : "worden in overleg vastgesteld",
      referentie: blank(v.referentie, "[referentiedagen en -uren]"),
      overwerk_pct: blank(v.overwerk_pct, "100"),
      betaaldag: blank(v.betaaldag, "uiterlijk op de laatste werkdag van elke maand"),
      vakantiebijslag: blank(v.vakantiebijslag, "8"),
      vakantiebijslag_maand: blank(v.vakantiebijslag_maand, "mei"),
      ziekte_jaar1: blank(v.ziekte_jaar1, "70"),
      ziekte_jaar2: blank(v.ziekte_jaar2, "70"),
      vergoedingen: v.vergoedingen?.trim() ?? "",
    });
    let n = 0;
    const a = (t: string) => `## Artikel ${++n} – ${t}`;
    const parts = [
      `# Arbeidsovereenkomst`,
      `De ondergetekenden:`,
      `1. ${partyLine(v, "wg", "Werkgever")};`,
      `2. ${blank(v.wn_naam, "[naam werknemer]")}, wonende te ${blank(v.wn_adres, "[adres]")}${v.wn_geboortedatum ? `, geboren op ${fmtDate(v.wn_geboortedatum)}` : ""}, hierna: "Werknemer";`,
      `verklaren een arbeidsovereenkomst als bedoeld in artikel 7:610 van het Burgerlijk Wetboek te zijn aangegaan onder de volgende voorwaarden.`,
      a("Functie en plaats van de werkzaamheden"),
      c("functie"),
      a("Duur"),
      c(bepaald ? "duur_bepaald" : "duur_onbepaald"),
      a("Proeftijd"),
      c(proef ? "proeftijd" : "geen_proeftijd"),
      a("Arbeidsduur"),
      c(v.contractsoort === "oproep" ? "arbeidsduur_oproep" : "arbeidsduur"),
      ...(v.werkpatroon === "onvoorspelbaar" ? [c("werkpatroon_onvoorspelbaar")] : []),
      a("Salaris en vakantiebijslag"),
      c("salaris"),
      ...(v.overwerk ? [a("Overwerk"), c(`overwerk_${v.overwerk}`)] : []),
      ...(v.vergoedingen?.trim() ? [a("Vergoedingen"), c("vergoedingen")] : []),
      a("Vakantie"),
      c("vakantie"),
      a("Arbeidsongeschiktheid"),
      c(v.ziekte_jaar1?.trim() || v.ziekte_jaar2?.trim() ? "ziekte_aangepast" : "ziekte"),
      a("Geheimhouding"),
      c("geheimhouding"),
      a("Nevenwerkzaamheden"),
      c(v.nevenwerk === "beperkt" ? "nevenwerkzaamheden_beperkt" : "nevenwerkzaamheden"),
      a("Scholing"),
      c("scholing"),
    ];
    if (v.concurrentiebeding === "ja") parts.push(a("Concurrentiebeding"), c("concurrentiebeding"));
    if (v.relatiebeding === "ja") parts.push(a("Relatiebeding"), c("relatiebeding"));
    if (bepaald && (v.concurrentiebeding === "ja" || v.relatiebeding === "ja")) parts.push(c("concurrentie_motivering"));
    parts.push(
      a("Opzegging"),
      c(v.opzeg_wn === "2" || v.opzeg_wn === "3" ? "opzegging_verlengd" : "opzegging"),
      a("Cao en pensioen"),
      c(v.cao?.trim() ? "cao" : "geen_cao"),
      c(v.pensioen?.trim() ? "pensioen" : "geen_pensioen"),
      ...(extra ?? []).flatMap((e) => [a(e.title), c.fill(e.text)]),
      a("Slotbepalingen"),
      c("slot"),
      signLine(v),
      `SIGN: Werkgever\n${blank(v.wg_vertegenwoordiger || v.wg_naam, "[naam]")} || Werknemer\n${blank(v.wn_naam, "[naam]")}`,
    );
    return parts.join("\n\n");
  },
};

const huurovereenkomst: Template = {
  id: "huurovereenkomst",
  title: "Huurovereenkomst woonruimte",
  description: "Huurovereenkomst voor zelfstandige woonruimte (afdeling 7.4.5 BW).",
  sources: [art(7, "232"), art(7, "237"), art(7, "248"), art(7, "252"), art(7, "261b"), art(7, "271"), art(7, "274"), law("Wet goed verhuurderschap", "BWBR0048028"), law("Wet betaalbare huur", "BWBR0049889")],
  rules: [
    "Huur voor onbepaalde tijd is de hoofdregel; bepaalde tijd (ten hoogste twee jaar) alleen voor de bij AMvB aangewezen categorieën huurders (art. 7:271 lid 2 BW).",
    "Waarborgsom ten hoogste tweemaal de kale huurprijs; terugbetaling binnen veertien dagen na het einde van de huur, of binnen dertig dagen bij verrekening van kosten (art. 7:261b BW).",
    "Verhuurder zegt alleen op op een grond van art. 7:274 lid 1 BW, bij exploot of aangetekende brief, met een termijn van drie maanden plus één maand per huurjaar, tot ten hoogste zes maanden (art. 7:271 BW).",
    "Huurverhoging: een indexatiebeding koppelt de verhoging aan de CPI en blijft binnen de wettelijk toegestane maximale huurverhoging; een opslag bovenop de CPI wordt afzonderlijk en duidelijk geformuleerd (vgl. HR 29 november 2024 over indexatiebedingen).",
    "Huurder krijgt de schriftelijke informatie die de Wet goed verhuurderschap voorschrijft, waaronder de contactgegevens van het gemeentelijk meldpunt.",
    "De huurprijs blijft binnen het maximum volgens het woningwaarderingsstelsel waar de Wet betaalbare huur dat voorschrijft.",
    "Bedingen ten nadele van de huurder die afwijken van dwingend recht in afdeling 7.4.5 BW zijn nietig; neem ze niet op.",
  ],
  groups: [
    party("vh", "Verhuurder"),
    { title: "Huurder", fields: [
      { name: "hr_naam", label: "Naam", type: "text", required: true },
      { name: "hr_adres", label: "Huidig adres", type: "text" },
      { name: "hr_geboortedatum", label: "Geboortedatum", type: "date" },
    ] },
    { title: "Het gehuurde", fields: [
      { name: "object_adres", label: "Adres van de woonruimte", type: "text", required: true },
      { name: "object_omschrijving", label: "Omschrijving (bijv. driekamerappartement met berging)", type: "text" },
      { name: "ingangsdatum", label: "Ingangsdatum", type: "date", required: true },
      { name: "duur", label: "Duur", type: "select", default: "onbepaald", options: [
        { value: "onbepaald", label: "Onbepaalde tijd" },
        { value: "bepaald", label: "Bepaalde tijd (alleen uitzonderingscategorie, art. 7:271 lid 2 BW)" },
      ] },
      { name: "einddatum", label: "Einddatum", type: "date", showIf: (v) => v.duur === "bepaald" },
      { name: "categorie", label: "Categorie huurder (bijv. student, jongere tot 27 jaar)", type: "text", showIf: (v) => v.duur === "bepaald" },
    ] },
    { title: "Huurprijs", fields: [
      { name: "kale_huur", label: "Kale huurprijs per maand (€)", type: "number", required: true },
      { name: "servicekosten", label: "Voorschot servicekosten per maand (€)", type: "number", default: "0" },
      { name: "waarborgsom", label: "Waarborgsom (€)", type: "number" },
      { name: "iban", label: "IBAN verhuurder", type: "text" },
      { name: "sector", label: "Huursector", type: "select", default: "vrij", options: [
        { value: "vrij", label: "Vrije sector" },
        { value: "midden", label: "Middenhuur (gereguleerd)" },
        { value: "sociaal", label: "Sociale huur (gereguleerd)" },
      ] },
      { name: "huurverhoging", label: "Jaarlijkse huurverhoging", type: "select", default: "cpi", options: [
        { value: "cpi", label: "CPI-indexatie" },
        { value: "cpi_opslag", label: "CPI plus opslag" },
        { value: "geen", label: "Geen indexatiebeding" },
      ] },
      { name: "opslag", label: "Opslag bovenop CPI (%)", type: "number", default: "1", showIf: (v) => v.huurverhoging === "cpi_opslag" },
      { name: "meldpunt", label: "Gemeentelijk meldpunt (contactgegevens)", type: "text", placeholder: "bijv. meldpunt goed verhuurderschap gemeente Utrecht, 14 030" },
    ] },
    { title: "Meer opties", advanced: true, fields: [
      { name: "betaaldag", label: "Betaling huur", type: "text", default: "uiterlijk op de eerste dag van iedere maand" },
      { name: "servicekosten_spec", label: "Specificatie servicekosten (leeg = niet vermelden)", type: "textarea", placeholder: "bijv. schoonmaak gemeenschappelijke ruimten, energie algemene ruimten" },
      { name: "onderhuur", label: "Onderhuur", type: "select", default: "toestemming", options: [
        { value: "toestemming", label: "Geheel alleen met toestemming" },
        { value: "deel", label: "Deel toegestaan, geheel alleen met toestemming" },
        { value: "verboden", label: "Niet toegestaan" },
      ] },
      { name: "huisdieren", label: "Huisdieren", type: "select", default: "", options: [
        { value: "", label: "Niet vermelden" },
        { value: "toegestaan", label: "Toegestaan" },
        { value: "toestemming", label: "Met toestemming" },
        { value: "niet", label: "Niet toegestaan" },
      ] },
      { name: "gemeubileerd", label: "Gemeubileerd met inventarislijst", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
    ] },
    signing,
  ],
  checks: (v) => {
    const out: string[] = [];
    const huur = num(v.kale_huur);
    const borg = num(v.waarborgsom);
    if (!isNaN(huur) && !isNaN(borg) && borg > 2 * huur)
      out.push(`Waarborgsom bedraagt ten hoogste tweemaal de kale huurprijs, hier ${eur(2 * huur)} (art. 7:261b lid 2 BW).`);
    if (v.duur === "bepaald") {
      out.push("Sinds 1 juli 2024 is huur voor bepaalde tijd alleen toegestaan voor bij AMvB aangewezen categorieën huurders, voor ten hoogste twee jaar (art. 7:271 lid 2 BW). Controleer of de huurder daaronder valt.");
      if (v.ingangsdatum && v.einddatum && monthsBetween(v.ingangsdatum, v.einddatum) > 24.1)
        out.push("Duur bepaalde tijd langer dan twee jaar: de uitzondering van art. 7:271 lid 2 BW is dan niet van toepassing.");
      out.push("Verhuurder moet de huurder niet eerder dan drie maanden en uiterlijk één maand voor de einddatum schriftelijk informeren; anders wordt de huur voor onbepaalde tijd verlengd (art. 7:271 lid 2 BW).");
    }
    if (v.sector === "vrij") {
      out.push("Controleer of de woning op grond van het woningwaarderingsstelsel buiten de gereguleerde huur valt (Wet betaalbare huur).");
      if (v.huurverhoging === "cpi_opslag" && num(v.opslag) > 1)
        out.push("In de vrije sector is de jaarlijkse huurverhoging wettelijk gemaximeerd; een opslag van meer dan 1% bovenop de CPI wordt niet volledig geëffectueerd.");
    } else
      out.push("Gereguleerde huur: de huurprijs mag niet hoger zijn dan het maximum volgens het woningwaarderingsstelsel, en een huurverhoging verloopt via een voorstel binnen het wettelijke maximum (art. 7:252 BW, Wet betaalbare huur).");
    if (!v.meldpunt?.trim()) out.push("Vermeld de contactgegevens van het gemeentelijk meldpunt (Wet goed verhuurderschap).");
    return out;
  },
  clauses: HUUR,
  render: (v, custom, extra) => {
    const bepaald = v.duur === "bepaald";
    let n = 0;
    const a = (t: string) => `## Artikel ${++n} – ${t}`;
    const huur = num(v.kale_huur) || 0;
    const sk = num(v.servicekosten) || 0;
    const c = clauseFn(HUUR, custom, {
      object_adres: blank(v.object_adres, "[adres]"),
      bestaande_uit: v.object_omschrijving ? `, bestaande uit ${v.object_omschrijving}` : "",
      ingangsdatum: fmtDate(v.ingangsdatum),
      einddatum: fmtDate(v.einddatum),
      categorie: blank(v.categorie, "[categorie]"),
      kale_huur: eur(huur),
      servicekosten: eur(sk),
      totaal: eur(huur + sk),
      op_rekening: v.iban ? ` op rekeningnummer ${v.iban}` : "",
      opslag: blank(v.opslag, "[percentage]"),
      servicekosten_spec: v.servicekosten_spec?.trim() ? ` De servicekosten betreffen: ${v.servicekosten_spec.trim()}.` : "",
      betaaldag: blank(v.betaaldag, "uiterlijk op de eerste dag van iedere maand"),
      onderhuur:
        v.onderhuur === "verboden"
          ? "Onderverhuur van het gehuurde, geheel of gedeeltelijk, is niet toegestaan."
          : v.onderhuur === "deel"
            ? "Onderverhuur van een deel van het gehuurde is toegestaan; onderverhuur van het gehele gehuurde is niet toegestaan zonder schriftelijke toestemming van Verhuurder."
            : "Onderverhuur van het gehele gehuurde is niet toegestaan zonder schriftelijke toestemming van Verhuurder.",
      meldpunt: v.meldpunt?.trim() ? ` (${v.meldpunt.trim()})` : "",
      waarborgsom: eur(v.waarborgsom),
    });
    return [
      `# Huurovereenkomst woonruimte`,
      `De ondergetekenden:`,
      `1. ${partyLine(v, "vh", "Verhuurder")};`,
      `2. ${blank(v.hr_naam, "[naam huurder]")}${v.hr_adres ? `, thans wonende te ${v.hr_adres}` : ""}${v.hr_geboortedatum ? `, geboren op ${fmtDate(v.hr_geboortedatum)}` : ""}, hierna: "Huurder";`,
      `komen het volgende overeen.`,
      a("Het gehuurde"),
      c("gehuurde"),
      a("Duur"),
      c(bepaald ? "duur_bepaald" : "duur_onbepaald"),
      a("Huurprijs en servicekosten"),
      c("huurprijs"),
      a("Huurverhoging"),
      c(v.huurverhoging === "cpi_opslag" ? "huurverhoging_opslag" : v.huurverhoging === "geen" ? "huurverhoging_geen" : "huurverhoging"),
      a("Betaling"),
      c("betaling"),
      a("Waarborgsom"),
      c("waarborgsom"),
      a("Gebruik en onderhoud"),
      c("gebruik"),
      ...(v.huisdieren ? [a("Huisdieren"), c(`huisdieren_${v.huisdieren}`)] : []),
      ...(v.gemeubileerd === "ja" ? [a("Inventaris"), c("inventaris")] : []),
      a("Opzegging"),
      c("opzegging"),
      a("Oplevering"),
      c("oplevering"),
      a("Informatie aan Huurder"),
      c("informatie"),
      ...(extra ?? []).flatMap((e) => [a(e.title), c.fill(e.text)]),
      a("Toepasselijk recht"),
      c("recht"),
      signLine(v),
      `SIGN: Verhuurder\n${blank(v.vh_vertegenwoordiger || v.vh_naam, "[naam]")} || Huurder\n${blank(v.hr_naam, "[naam]")}`,
    ].join("\n\n");
  },
};

const geheimhouding: Template = {
  id: "geheimhouding",
  title: "Geheimhoudingsovereenkomst (NDA)",
  description: "Wederzijdse of eenzijdige geheimhoudingsovereenkomst met boetebeding.",
  sources: [art(6, "91"), art(6, "92"), art(6, "93"), art(6, "94"), law("Wet bescherming bedrijfsgeheimen", "BWBR0041459", "1")],
  rules: [
    "Omschrijf de vertrouwelijke informatie en het doel concreet. De overeenkomst geldt als redelijke maatregel om bedrijfsgeheimen te beschermen (art. 1 Wet bescherming bedrijfsgeheimen).",
    "Boetebeding: vermeld of de boete in de plaats komt van schadevergoeding of daarnaast geldt (art. 6:92 BW). Zonder uitdrukkelijke afspraak is een ingebrekestelling vereist (art. 6:93 BW). De rechter kan matigen als de billijkheid dat klaarblijkelijk eist (art. 6:94 BW).",
    "Is een partij werknemer van de andere partij, dan gelden voor een boetebeding de beperkingen van art. 7:650 BW.",
    "Neem uitzonderingen op voor algemeen bekende, al bekende en rechtmatig van derden verkregen informatie, en voor wettelijke openbaarmakingsplichten.",
  ],
  groups: [
    party("p1", "Partij 1"),
    party("p2", "Partij 2"),
    { title: "Inhoud", fields: [
      { name: "richting", label: "Soort", type: "select", default: "wederzijds", options: [
        { value: "wederzijds", label: "Wederzijds" },
        { value: "eenzijdig", label: "Eenzijdig (Partij 1 verstrekt informatie)" },
      ] },
      { name: "doel", label: "Doel waarvoor informatie wordt gedeeld", type: "textarea", required: true, placeholder: "bijv. het beoordelen van een mogelijke samenwerking op het gebied van ..." },
      { name: "duur", label: "Duur geheimhoudingsplicht (jaren na beëindiging)", type: "number", default: "3" },
      { name: "boete", label: "Boete per overtreding (€)", type: "number", default: "10000" },
      { name: "boete_dag", label: "Boete per dag dat overtreding voortduurt (€)", type: "number", default: "500" },
      { name: "boete_verhouding", label: "Boete en schadevergoeding", type: "select", default: "naast", options: [
        { value: "naast", label: "Boete naast volledige schadevergoeding" },
        { value: "plaats", label: "Boete in plaats van schadevergoeding (wettelijke hoofdregel)" },
      ] },
      { name: "p2_werknemer", label: "Partij 2 is werknemer van Partij 1", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
      { name: "rechtbank", label: "Bevoegde rechtbank", type: "text", default: "Rechtbank Amsterdam" },
    ] },
    { title: "Meer opties", advanced: true, fields: [
      { name: "teruggave_termijn", label: "Termijn teruggave na verzoek (leeg = op eerste verzoek)", type: "text", placeholder: "bijv. veertien dagen" },
      { name: "geschil", label: "Geschillen", type: "select", default: "rechter", options: [
        { value: "rechter", label: "Rechter" },
        { value: "mediation", label: "Eerst mediation, dan rechter" },
        { value: "arbitrage", label: "Arbitrage (NAI)" },
      ] },
      { name: "arbitrage_plaats", label: "Plaats van arbitrage", type: "text", default: "Amsterdam", showIf: (v) => v.geschil === "arbitrage" },
    ] },
    signing,
  ],
  checks: (v) => {
    const out = ["Een boete kan door de rechter worden gematigd indien de billijkheid dit klaarblijkelijk eist (art. 6:94 BW)."];
    if (v.p2_werknemer === "ja")
      out.push("Boetebeding met een werknemer: art. 7:650 BW geldt (schriftelijk, bestemming en hoogte); afwijken kan alleen bij een loon boven het wettelijk minimumloon.");
    if (!v.doel?.trim()) out.push("Omschrijf het doel concreet; de reikwijdte van de geheimhoudingsplicht hangt daarvan af.");
    return out;
  },
  clauses: NDA,
  render: (v, custom, extra) => {
    const w = v.richting !== "eenzijdig";
    const ontvanger = w ? "de ontvangende Partij" : "Partij 2";
    const c = clauseFn(NDA, custom, {
      verstrekker: w ? "een Partij" : "Partij 1",
      ontvanger,
      Ontvanger: w ? "De ontvangende Partij" : "Partij 2",
      duur: blank(v.duur, "[aantal]"),
      boete: eur(v.boete),
      boete_dag: eur(v.boete_dag),
      rechtbank: blank(v.rechtbank, "[rechtbank]"),
      teruggave: v.teruggave_termijn?.trim() ? `Binnen ${v.teruggave_termijn.trim()} na een verzoek daartoe` : "Op eerste verzoek",
      arbitrage_plaats: blank(v.arbitrage_plaats, "[plaats]"),
    });
    let n = 0;
    const a = (t: string) => `## Artikel ${++n} – ${t}`;
    return [
      `# Geheimhoudingsovereenkomst`,
      `De ondergetekenden:`,
      `1. ${partyLine(v, "p1", "Partij 1")};`,
      `2. ${partyLine(v, "p2", "Partij 2")};`,
      `hierna gezamenlijk: "Partijen", overwegende dat ${w ? "Partijen over en weer" : "Partij 1 aan Partij 2"} vertrouwelijke informatie ${w ? "zullen verstrekken" : "zal verstrekken"} ten behoeve van: ${blank(v.doel, "[doel]")} (hierna: "het Doel"); komen het volgende overeen.`,
      a("Vertrouwelijke informatie"),
      c("informatie"),
      a("Verplichtingen"),
      c("verplichtingen"),
      a("Wettelijke verplichting"),
      c("wettelijk"),
      a("Duur"),
      c("duur"),
      a("Teruggave"),
      c("teruggave"),
      a("Boete"),
      c(v.boete_verhouding === "plaats" ? "boete_plaats" : "boete"),
      ...(v.p2_werknemer === "ja" ? [c("boete_werknemer")] : []),
      ...(extra ?? []).flatMap((e) => [a(e.title), c.fill(e.text)]),
      a("Toepasselijk recht en forum"),
      c(v.geschil === "mediation" ? "forum_mediation" : v.geschil === "arbitrage" ? "forum_arbitrage" : "forum"),
      signLine(v),
      `SIGN: Partij 1\n${blank(v.p1_vertegenwoordiger || v.p1_naam, "[naam]")} || Partij 2\n${blank(v.p2_vertegenwoordiger || v.p2_naam, "[naam]")}`,
    ].join("\n\n");
  },
};

const volmacht: Template = {
  id: "volmacht",
  title: "Volmacht",
  description: "Onderhandse volmacht voor het verrichten van rechtshandelingen (titel 3.3 BW).",
  sources: [art(3, "60"), art(3, "61"), art(3, "62"), art(3, "64"), art(3, "68"), art(3, "72"), art(3, "74"), art(3, "260")],
  rules: [
    "Omschrijf de rechtshandelingen concreet (bijzondere volmacht) of maak duidelijk dat het om een algemene volmacht gaat; een algemene volmacht geldt alleen voor daden van beheer (art. 3:62 BW).",
    "Een volmacht tot het verlenen van een hypotheek moet bij notariële akte worden verleend (art. 3:260 lid 3 BW). Voor andere notariële akten, zoals de levering van een woning, stelt de notaris doorgaans eigen eisen.",
    "Substitutie alleen als die uitdrukkelijk is toegestaan of in de gevallen van art. 3:64 BW.",
    "Een onherroepelijke volmacht vereist dat zij strekt tot een rechtshandeling in het belang van de gevolmachtigde of een derde (art. 3:74 lid 1 BW).",
    "Optreden als wederpartij van de volmachtgever (Selbsteintritt) alleen als de volmacht dat toestaat of strijd tussen de belangen is uitgesloten (art. 3:68 BW).",
    "De volmacht eindigt onder meer door dood, ondercuratelestelling of faillissement van de volmachtgever en door herroeping (art. 3:72 BW).",
  ],
  groups: [
    { title: "Volmachtgever", fields: [
      { name: "vmg_naam", label: "Naam", type: "text", required: true },
      { name: "vmg_geboorte", label: "Geboortedatum en -plaats", type: "text" },
      { name: "vmg_adres", label: "Adres en woonplaats", type: "text", required: true },
    ] },
    { title: "Gevolmachtigde", fields: [
      { name: "gm_naam", label: "Naam", type: "text", required: true },
      { name: "gm_geboorte", label: "Geboortedatum en -plaats", type: "text" },
      { name: "gm_adres", label: "Adres en woonplaats", type: "text", required: true },
    ] },
    { title: "Inhoud", fields: [
      { name: "handelingen", label: "Rechtshandelingen waartoe volmacht wordt verleend", type: "textarea", required: true, placeholder: "bijv. het namens volmachtgever opzeggen van de huurovereenkomst betreffende ..." },
      { name: "substitutie", label: "Substitutie toegestaan", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
      { name: "geldig_tot", label: "Geldig tot en met (leeg = tot herroeping)", type: "date" },
      { name: "soort", label: "Soort volmacht", type: "select", default: "bijzonder", options: [
        { value: "bijzonder", label: "Bijzondere volmacht (bepaalde rechtshandelingen)" },
        { value: "algemeen", label: "Algemene volmacht (daden van beheer)" },
      ] },
      { name: "onherroepelijk", label: "Herroepelijkheid", type: "select", default: "nee", options: [
        { value: "nee", label: "Herroepelijk" },
        { value: "ja", label: "Onherroepelijk" },
      ] },
      { name: "belang", label: "In wiens belang (vereist voor onherroepelijkheid)", type: "text", showIf: (v) => v.onherroepelijk === "ja", placeholder: "bijv. Gevolmachtigde als koper van de woning" },
      { name: "selbsteintritt", label: "Gevolmachtigde mag ook als wederpartij optreden", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
    ] },
    { title: "Meer opties", advanced: true, fields: [
      { name: "legalisatie", label: "Handtekening laten legaliseren door notaris", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
    ] },
    signing,
  ],
  checks: (v) => {
    const out: string[] = [];
    if (/hypothe/i.test(v.handelingen ?? ""))
      out.push("Een volmacht tot het verlenen van een hypotheek moet bij notariële akte worden verleend (art. 3:260 lid 3 BW); deze onderhandse volmacht volstaat daarvoor niet.");
    else if (/onroerend|levering|notari/i.test(v.handelingen ?? ""))
      out.push("Voor rechtshandelingen die bij notariële akte plaatsvinden (levering onroerende zaak, hypotheek) stelt de notaris doorgaans eigen eisen aan vorm en legalisatie van de volmacht.");
    out.push("De volmacht eindigt o.a. door dood, ondercuratelestelling of faillissement van de volmachtgever en door herroeping (art. 3:72 BW).");
    if (v.onherroepelijk === "ja" && !v.belang?.trim())
      out.push("Een volmacht is alleen onherroepelijk als zij strekt tot een rechtshandeling in het belang van de gevolmachtigde of een derde; vermeld dat belang (art. 3:74 lid 1 BW).");
    if (v.soort === "algemeen")
      out.push("Een algemene volmacht geldt alleen voor daden van beheer; beschikkingshandelingen moeten uitdrukkelijk worden omschreven (art. 3:62 lid 2 BW).");
    return out;
  },
  clauses: VOLMACHT,
  render: (v, custom, extra) => {
    const onh = v.onherroepelijk === "ja";
    const c = clauseFn(VOLMACHT, custom, { geldig_tot: fmtDate(v.geldig_tot), belang: blank(v.belang, "[belang]") });
    return [
      `# Volmacht`,
      `De ondergetekende:`,
      `${blank(v.vmg_naam, "[naam]")}${v.vmg_geboorte ? `, geboren ${v.vmg_geboorte}` : ""}, wonende te ${blank(v.vmg_adres, "[adres]")}, hierna: "Volmachtgever",`,
      `verklaart hierbij volmacht te verlenen aan:`,
      `${blank(v.gm_naam, "[naam]")}${v.gm_geboorte ? `, geboren ${v.gm_geboorte}` : ""}, wonende te ${blank(v.gm_adres, "[adres]")}, hierna: "Gevolmachtigde",`,
      `## Omvang`,
      c(v.soort === "algemeen" ? "omvang_algemeen" : "omvang"),
      blank(v.handelingen, "[omschrijving rechtshandelingen]"),
      c("bevoegdheid"),
      ...(v.selbsteintritt === "ja" ? [c("selbsteintritt")] : []),
      `## Substitutie`,
      c(v.substitutie === "ja" ? "substitutie" : "geen_substitutie"),
      `## Duur`,
      c(v.geldig_tot ? "duur_tot" : onh ? "duur_onherroepelijk" : "duur_herroeping"),
      ...(onh ? [c("onherroepelijk")] : []),
      ...(extra ?? []).flatMap((e) => [`## ${e.title}`, c.fill(e.text)]),
      ...(v.legalisatie === "ja" ? [c("legalisatie")] : []),
      c("recht"),
      `Getekend te ${blank(v.plaats, "[plaats]")} op ${fmtDate(v.datum)}.`,
      `SIGN: Volmachtgever\n${blank(v.vmg_naam, "[naam]")} || Voor aanvaarding, Gevolmachtigde\n${blank(v.gm_naam, "[naam]")}`,
    ].join("\n\n");
  },
};

const ingebrekestelling: Template = {
  id: "ingebrekestelling",
  title: "Aanmaning en ingebrekestelling",
  description: "Betalingsherinnering met ingebrekestelling; voor consumenten als veertiendagenbrief (art. 6:96 lid 6 BW).",
  sources: [art(6, "81"), art(6, "82"), art(6, "83"), art(6, "96"), art(6, "119"), art(6, "119a"), law("Besluit vergoeding voor buitengerechtelijke incassokosten", "BWBR0031432", "2")],
  rules: [
    "De ingebrekestelling is schriftelijk en geeft een redelijke termijn voor nakoming (art. 6:82 BW).",
    "Bij een consument (veertiendagenbrief): betalingstermijn van ten minste veertien dagen, te rekenen vanaf de dag na ontvangst van de brief; noem geen vaste einddatum die eerder kan vallen (art. 6:96 lid 6 BW; HR ECLI:NL:HR:2016:2704).",
    "Noem het exacte bedrag aan buitengerechtelijke incassokosten volgens de staffel van het Besluit vergoeding voor buitengerechtelijke incassokosten (15% over de eerste € 2.500, 10% over de volgende € 2.500, 5% over de volgende € 5.000, 1% over de volgende € 190.000, 0,5% over het meerdere; minimaal € 40, maximaal € 6.775).",
    `Wettelijke rente per 1 januari 2026: ${RENTE.consument} per jaar (art. 6:119 BW). Wettelijke handelsrente per 1 juli 2026: ${RENTE.zakelijk} per jaar (art. 6:119a BW), verschuldigd vanaf de vervaldatum.`,
    "Bij een handelsovereenkomst is de vergoeding van ten minste € 40 verschuldigd zonder aanmaning (art. 6:96 lid 4 BW).",
    "Btw over de incassokosten mag alleen worden gevorderd als de schuldeiser de btw niet kan verrekenen.",
  ],
  groups: [
    { title: "Schuldeiser (afzender)", fields: [
      { name: "sch_naam", label: "Naam", type: "text", required: true },
      { name: "sch_adres", label: "Adres", type: "text" },
      { name: "sch_iban", label: "IBAN", type: "text" },
      { name: "sch_contact", label: "Contactgegevens (e-mail / telefoon)", type: "text" },
    ] },
    { title: "Schuldenaar (geadresseerde)", fields: [
      { name: "deb_naam", label: "Naam", type: "text", required: true },
      { name: "deb_adres", label: "Adres", type: "text" },
      { name: "deb_type", label: "Soort schuldenaar", type: "select", default: "consument", options: [
        { value: "consument", label: "Consument (natuurlijk persoon, niet in beroep of bedrijf)" },
        { value: "zakelijk", label: "Onderneming (handelsovereenkomst)" },
      ] },
    ] },
    { title: "Vordering", fields: [
      { name: "omschrijving", label: "Omschrijving (bijv. geleverde diensten)", type: "text" },
      { name: "factuurnummer", label: "Factuurnummer(s)", type: "text", required: true },
      { name: "factuurdatum", label: "Factuurdatum", type: "date" },
      { name: "vervaldatum", label: "Vervaldatum", type: "date" },
      { name: "hoofdsom", label: "Openstaande hoofdsom (€)", type: "number", required: true },
      { name: "termijn", label: "Betalingstermijn (dagen)", type: "number", default: "14" },
    ] },
    { title: "Brief", fields: [
      { name: "plaats", label: "Plaats", type: "text" },
      { name: "datum", label: "Datum brief", type: "date" },
      { name: "verzending", label: "Verzendwijze (vermeld in de brief)", type: "select", default: "", options: [
        { value: "", label: "Niet vermelden" },
        { value: "aangetekend", label: "Aangetekend en per gewone post" },
        { value: "post", label: "Per gewone post" },
        { value: "email", label: "Per e-mail" },
      ] },
      { name: "btw_incasso", label: "Schuldeiser kan btw niet verrekenen (btw over incassokosten)", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja, 21% btw toevoegen" },
      ] },
    ] },
    { title: "Meer opties", advanced: true, fields: [
      { name: "contactpersoon", label: "Contactpersoon voor vragen", type: "text" },
      { name: "ondertekenaar", label: "Ondertekend door (naam en functie)", type: "text", placeholder: "bijv. mr. A. Smit, advocaat" },
    ] },
  ],
  checks: (v) => {
    const out: string[] = [];
    const t = num(v.termijn);
    if (v.deb_type === "consument" && (!(t >= 14)))
      out.push("Bij consumenten moet de betalingstermijn ten minste veertien dagen bedragen, aanvangend de dag na aanmaning (art. 6:96 lid 6 BW).");
    if (v.deb_type === "consument")
      out.push("Incassokosten zijn bij consumenten pas verschuldigd na deze veertiendagenbrief en mogen niet hoger zijn dan de BIK-staffel.");
    else out.push("Bij een handelsovereenkomst is de vergoeding van € 40 zonder aanmaning verschuldigd na de vervaldag (art. 6:96 lid 4 BW).");
    const h = num(v.hoofdsom);
    if (h > 0) out.push(`Incassokosten volgens BIK-staffel over ${eur(h)}: ${eur(incassokosten(h))} (excl. btw)${v.btw_incasso === "ja" ? `, ${eur(incassokosten(h) * 1.21)} inclusief btw` : ""}.`);
    if (v.verzending === "email")
      out.push("Verzending per e-mail is alleen geschikt als de schuldenaar met elektronische communicatie heeft ingestemd; de termijn loopt vanaf de dag na ontvangst, dus bewaar bewijs van ontvangst.");
    else if (v.deb_type === "consument" && v.verzending !== "aangetekend")
      out.push("Bij een consument moet u de ontvangst van de veertiendagenbrief kunnen aantonen; overweeg aangetekende verzending.");
    return out;
  },
  clauses: AANMANING,
  render: (v, custom, extra) => {
    const consument = v.deb_type !== "zakelijk";
    const h = num(v.hoofdsom);
    const kosten = incassokosten(h);
    const termijn = blank(v.termijn, "14");
    const deadline = v.datum && num(v.termijn) > 0 ? fmtDate(addDays(v.datum, num(v.termijn))) : null;
    const c = clauseFn(AANMANING, custom, {
      factuurdatum: fmtDate(v.factuurdatum),
      sch_naam: blank(v.sch_naam, "[naam]"),
      factuurnummer: blank(v.factuurnummer, "[nummer]"),
      voor_omschrijving: v.omschrijving ? ` voor ${v.omschrijving}` : "",
      vervaldatum: fmtDate(v.vervaldatum),
      hoofdsom: eur(h),
      termijn,
      uiterlijk_op: deadline ? `, uiterlijk op ${deadline}` : "",
      iban: blank(v.sch_iban, "[IBAN]"),
      incassokosten: v.btw_incasso === "ja" ? `${eur(Math.round(kosten * 121) / 100)} (inclusief 21% btw)` : eur(kosten),
      via_contact: `${v.contactpersoon?.trim() ? ` met ${v.contactpersoon.trim()}` : ""}${v.sch_contact ? ` via ${v.sch_contact}` : ""}`,
      rente: RENTE[consument ? "consument" : "zakelijk"],
    });
    const k = consument ? "consument" : "zakelijk";
    return [
      `${blank(v.sch_naam, "[naam schuldeiser]")}\n${blank(v.sch_adres, "")}\n${blank(v.sch_contact, "")}`.trim(),
      `${blank(v.deb_naam, "[naam schuldenaar]")}\n${blank(v.deb_adres, "")}`.trim(),
      `${blank(v.plaats, "[plaats]")}, ${fmtDate(v.datum)}`,
      ...(v.verzending ? [({ aangetekend: "Per aangetekende post en per gewone post", post: "Per post", email: "Per e-mail" } as Values)[v.verzending]] : []),
      `Betreft: aanmaning en ingebrekestelling – factuur ${blank(v.factuurnummer, "[nummer]")}`,
      `# Aanmaning en ingebrekestelling`,
      c("aanhef"),
      c("vordering"),
      c(`sommatie_${k}`),
      c(`verzuim_${k}`),
      c(`kosten_${k}`),
      ...(extra ?? []).map((e) => c.fill(e.text)),
      c("slot"),
      c("groet"),
      `SIGN: ${blank(v.sch_naam, "[naam]")}${v.ondertekenaar?.trim() ? `\n${v.ondertekenaar.trim()}` : ""} || `,
    ].join("\n\n");
  },
};

const vaststellingsovereenkomst: Template = {
  id: "vaststellingsovereenkomst",
  title: "Vaststellingsovereenkomst (beëindiging dienstverband)",
  description: "Beëindiging van een arbeidsovereenkomst met wederzijds goedvinden (art. 7:670b en 7:900 BW).",
  sources: [art(7, "900"), art(7, "670"), art(7, "670b"), art(7, "672"), art(7, "673"), art(7, "641")],
  rules: [
    "De overeenkomst is schriftelijk (art. 7:670b lid 1 en 7:900 BW).",
    "WW-proof: leg vast dat het initiatief bij de werkgever ligt, dat geen sprake is van een dringende reden of verwijtbaarheid van de werknemer, en dat de werknemer niet arbeidsongeschikt is wegens ziekte.",
    "Neem de bedenktermijn van veertien dagen op; ontbreekt die vermelding, dan geldt drie weken (art. 7:670b lid 2 en 3 BW).",
    "De einddatum respecteert de opzegtermijn die voor de werkgever zou gelden (art. 7:672 BW); anders gaat een WW-uitkering later in.",
    `Transitievergoeding: 1/3 maandsalaris per dienstjaar; in 2026 ten hoogste € ${TRANSITIE_MAX.toLocaleString("nl-NL")} of één jaarsalaris als dat hoger is (art. 7:673 BW). In een vaststellingsovereenkomst is de hoogte onderhandelbaar.`,
    "Neem finale kwijting op, behoudens de verplichtingen uit de overeenkomst zelf.",
  ],
  groups: [
    party("wg", "Werkgever"),
    { title: "Werknemer", fields: [
      { name: "wn_naam", label: "Naam", type: "text", required: true },
      { name: "wn_adres", label: "Adres en woonplaats", type: "text" },
    ] },
    { title: "Dienstverband", fields: [
      { name: "indienst", label: "Datum indiensttreding", type: "date", required: true },
      { name: "functie", label: "Functie", type: "text" },
      { name: "salaris", label: "Bruto maandsalaris excl. vakantiebijslag (€)", type: "number" },
      { name: "reden_type", label: "Soort aanleiding", type: "select", default: "anders", options: [
        { value: "reorganisatie", label: "Reorganisatie / bedrijfseconomische redenen" },
        { value: "verstoord", label: "Verstoorde arbeidsverhouding" },
        { value: "anders", label: "Anders (zie toelichting)" },
      ] },
      { name: "reden", label: "Aanleiding beëindiging (initiatief werkgever)", type: "textarea", placeholder: "bijv. een verstoorde arbeidsverhouding / reorganisatie" },
      { name: "ziek", label: "Werknemer is op dit moment arbeidsongeschikt (ziek)", type: "select", default: "nee", options: [
        { value: "nee", label: "Nee" },
        { value: "ja", label: "Ja" },
      ] },
      { name: "einddatum", label: "Einddatum arbeidsovereenkomst", type: "date", required: true },
    ] },
    { title: "Afspraken", fields: [
      { name: "vergoeding", label: "Bruto beëindigingsvergoeding (€)", type: "number" },
      { name: "vrijstelling", label: "Vrijstelling van werk tot einddatum", type: "select", default: "ja", options: [
        { value: "ja", label: "Ja" },
        { value: "nee", label: "Nee" },
      ] },
      { name: "concurrentie", label: "Concurrentie-/relatiebeding", type: "select", default: "vervalt", options: [
        { value: "vervalt", label: "Vervalt" },
        { value: "blijft", label: "Blijft van kracht" },
        { value: "nvt", label: "Niet van toepassing" },
      ] },
      { name: "advocaatkosten", label: "Vergoeding juridische kosten, max. excl. btw (€)", type: "number", default: "1000" },
      { name: "transitie", label: "Transitievergoeding", type: "select", default: "inbegrepen", options: [
        { value: "inbegrepen", label: "Inbegrepen in de beëindigingsvergoeding" },
        { value: "apart", label: "Naast de beëindigingsvergoeding" },
      ] },
      { name: "vakantiedagen_open", label: "Openstaande vakantiedagen (leeg = volgens administratie)", type: "number" },
      { name: "bonus", label: "Bonus of variabele beloning bij einde (leeg = n.v.t.)", type: "text", placeholder: "bijv. een bonus van € 2.500 bruto over 2026" },
    ] },
    { title: "Meer opties", advanced: true, fields: [
      { name: "betaaltermijn", label: "Betaling vergoeding", type: "text", default: "binnen een maand na de einddatum" },
      { name: "getuigschrift", label: "Getuigschrift", type: "select", default: "verzoek", options: [
        { value: "verzoek", label: "Op verzoek" },
        { value: "positief", label: "Positief getuigschrift en referentie" },
      ] },
      { name: "eigendommen", label: "In te leveren bedrijfseigendommen", type: "text", default: "alle bedrijfseigendommen", placeholder: "bijv. de leaseauto, laptop en toegangspas" },
      { name: "studiekosten", label: "Studiekosten", type: "select", default: "", options: [
        { value: "", label: "Niet vermelden" },
        { value: "kwijt", label: "Werkgever ziet af van terugbetaling" },
      ] },
    ] },
    signing,
  ],
  checks: (v) => {
    const out = ["De bedenktermijn van veertien dagen is opgenomen; zonder vermelding zou de termijn drie weken bedragen (art. 7:670b lid 3 BW)."];
    if (v.indienst && v.datum && v.einddatum) {
      const years = monthsBetween(v.indienst, v.datum) / 12;
      const req = years < 5 ? 1 : years < 10 ? 2 : years < 15 ? 3 : 4;
      const notice = monthsBetween(v.datum, v.einddatum);
      if (notice < req)
        out.push(`Einddatum ligt binnen de opzegtermijn van ${req} maand(en) die voor de werkgever zou gelden (art. 7:672 lid 2 BW). Dit kan gevolgen hebben voor de ingangsdatum van een WW-uitkering.`);
      const sal = num(v.salaris);
      const eindYears = monthsBetween(v.indienst, v.einddatum) / 12;
      if (sal > 0 && eindYears > 0) {
        const max = Math.max(TRANSITIE_MAX, sal * 1.08 * 12);
        out.push(`Indicatie transitievergoeding (1/3 maandloon per dienstjaar, incl. 8% vakantiebijslag, excl. overige vaste componenten): ${eur(Math.min((sal * 1.08 * eindYears) / 3, max))}. Wettelijk maximum 2026: ${eur(TRANSITIE_MAX)}, of één jaarsalaris als dat hoger is (art. 7:673 lid 2 BW).`);
      }
    }
    if (v.reden_type === "anders" && !v.reden?.trim()) out.push("Leg vast dat het initiatief bij de werkgever ligt en dat werknemer geen dringende reden heeft gegeven (relevant voor WW).");
    if (v.ziek === "ja")
      out.push("Werknemer is ziek: het opzegverbod bij ziekte (art. 7:670 BW) en het risico voor een Ziektewet- of WW-uitkering spelen mee. Laat dit beoordelen voordat partijen tekenen.");
    return out;
  },
  clauses: VSO,
  render: (v, custom, extra) => {
    let n = 0;
    const a = (t: string) => `## Artikel ${++n} – ${t}`;
    const c = clauseFn(VSO, custom, {
      indienst: fmtDate(v.indienst),
      in_functie: v.functie ? `, laatstelijk in de functie van ${v.functie}` : "",
      met_salaris: v.salaris ? `, tegen een bruto maandsalaris van ${eur(v.salaris)} exclusief vakantiebijslag` : "",
      reden:
        v.reden_type === "reorganisatie"
          ? `een reorganisatie om bedrijfseconomische redenen${v.reden?.trim() ? ` (${v.reden.trim()})` : ""}`
          : v.reden_type === "verstoord"
            ? `een verstoorde arbeidsverhouding, waarvan Werknemer geen verwijt kan worden gemaakt${v.reden?.trim() ? ` (${v.reden.trim()})` : ""}`
            : blank(v.reden, "[aanleiding]"),
      vakantiedagen: v.vakantiedagen_open?.trim() ? ` (${v.vakantiedagen_open.trim()} dagen)` : "",
      bonus: v.bonus?.trim() ? ` Daarnaast ontvangt Werknemer ${v.bonus.trim()}.` : "",
      einddatum: fmtDate(v.einddatum),
      vergoeding: eur(v.vergoeding),
      advocaatkosten: eur(v.advocaatkosten),
      betaaltermijn: blank(v.betaaltermijn, "binnen een maand na de einddatum"),
      getuigschrift:
        v.getuigschrift === "positief"
          ? "Werkgever verstrekt een positief getuigschrift (artikel 7:656 BW) en geeft desgevraagd een positieve referentie."
          : "Werkgever verstrekt op verzoek een getuigschrift (artikel 7:656 BW).",
      eigendommen: blank(v.eigendommen, "alle bedrijfseigendommen"),
    });
    const parts = [
      `# Vaststellingsovereenkomst`,
      `De ondergetekenden:`,
      `1. ${partyLine(v, "wg", "Werkgever")};`,
      `2. ${blank(v.wn_naam, "[naam werknemer]")}${v.wn_adres ? `, wonende te ${v.wn_adres}` : ""}, hierna: "Werknemer";`,
      `## Overwegende dat`,
      c("overweging_a"),
      c("overweging_b"),
      c("overweging_c"),
      ...(v.ziek === "ja" ? [c("overweging_d").replace(/^e\./, "d.")] : [c("overweging_ziekte"), c("overweging_d")]),
      `komen het volgende overeen.`,
      a("Einde arbeidsovereenkomst"),
      c("einde"),
      a("Vrijstelling van werk"),
      c(v.vrijstelling === "ja" ? "vrijstelling" : "geen_vrijstelling"),
      a("Beëindigingsvergoeding"),
      c(v.transitie === "apart" ? "vergoeding_apart" : "vergoeding"),
      a("Eindafrekening"),
      c("eindafrekening"),
      a("Juridische kosten"),
      c("kosten"),
    ];
    if (v.concurrentie === "vervalt" || v.concurrentie === "blijft")
      parts.push(a("Concurrentie- en relatiebeding"), c(`concurrentie_${v.concurrentie}`));
    parts.push(
      a("Getuigschrift en bedrijfseigendommen"),
      c("getuigschrift"),
      ...(v.studiekosten === "kwijt" ? [a("Studiekosten"), c("studiekosten")] : []),
      a("Bedenktermijn"),
      c("bedenktermijn"),
      a("Finale kwijting"),
      c("kwijting"),
      ...(extra ?? []).flatMap((e) => [a(e.title), c.fill(e.text)]),
      a("Toepasselijk recht"),
      c("recht"),
      signLine(v),
      `SIGN: Werkgever\n${blank(v.wg_vertegenwoordiger || v.wg_naam, "[naam]")} || Werknemer\n${blank(v.wn_naam, "[naam]")}`,
    );
    return parts.join("\n\n");
  },
};

export const TEMPLATES: Template[] = [
  arbeidsovereenkomst,
  huurovereenkomst,
  geheimhouding,
  volmacht,
  ingebrekestelling,
  vaststellingsovereenkomst,
];

/** Settings from /instellingen, per template id. */
export type TemplateSettings = {
  clauses: Record<string, ClauseTexts>;
  defaults: Record<string, Values>;
  extras: Record<string, ExtraClause[]>;
};

/** Starting values: the firm's defaults from /instellingen, else the template's own. */
export function defaults(t: Template, firm: Values = {}): Values {
  const v: Values = {};
  for (const g of t.groups) for (const f of g.fields) v[f.name] = firm[f.name] ?? f.default ?? "";
  return v;
}

// ---------- governance model (Boek 2 BW) ----------

const RECHTSVORM: Record<string, string> = {
  bv: "besloten vennootschap met beperkte aansprakelijkheid",
  nv: "naamloze vennootschap",
  stichting: "stichting",
  vereniging: "vereniging",
  cooperatie: "coöperatie",
};

/** Structuurregime grensbedrag (geplaatst kapitaal + reserves), vastgesteld bij KB. */
export const STRUCTUUR_GRENS = 16_000_000;

/** Article numbers per legal form; a coöperatie follows the vereniging rules (art. 2:53a BW). */
function govArts(f: string) {
  const pick = (nv: string, bv: string, st: string, ver: string) => (f === "nv" ? nv : f === "bv" ? bv : f === "stichting" ? st : ver);
  return {
    taak: pick("129", "239", "291", "44"),
    monistisch: pick("129a", "239a", "291a", "44a"),
    rvc: pick("140", "250", "292a", "47"),
    vert: pick("130", "240", "292", "45"),
    tbRvc: pick("140 lid 5", "250 lid 5", "292a lid 7", "47 lid 7"),
    obBestuur: pick("134 lid 4", "244 lid 4", "291 lid 5", "44 lid 5"),
    obRvc: pick("142 lid 4", "252 lid 4", "292a lid 5", "47 lid 5"),
    benoeming: pick("132", "242", "286 lid 4", "37"),
    statuten: pick("121", "231", "293", "42"),
    jaarrekening: pick("101", "210", "300", "48"),
    // structuurregime: criteria, verplichte RvC, benoeming bestuur, goedkeuringsrechten
    sCriteria: pick("153", "263", "", "63b"),
    sRvc: pick("158", "268", "", "63f"),
    sBenoeming: pick("162", "272", "", ""),
    sGoedkeuring: pick("164", "274", "", "63j"),
    sMonistisch: pick("164a", "274a", "", ""),
  };
}

export function governanceFacts(v: Values) {
  const f = v.rechtsvorm || "bv";
  const kapitaalvennootschap = f === "bv" || f === "nv";
  const leden = f === "vereniging" || f === "cooperatie";
  const werknemers = num(v.werknemers);
  const structuur =
    (kapitaalvennootschap || f === "cooperatie") &&
    num(v.kapitaal) >= STRUCTUUR_GRENS &&
    v.or === "ja" &&
    werknemers >= 100 &&
    v.vrijstelling !== "ja";
  const model = v.model || "bestuur";
  const toezicht = model === "twee" ? (leden || f === "stichting" ? "raad van toezicht" : "raad van commissarissen") : model === "een" ? "niet-uitvoerende bestuurders" : "";
  const av = f === "stichting" ? "" : leden ? "algemene ledenvergadering" : "algemene vergadering";
  return { f, kapitaalvennootschap, leden, werknemers, structuur, model, toezicht, av, beurs: f === "nv" && v.beurs === "ja" };
}

const a2 = (nr: string) => (nr ? `art. 2:${nr} BW` : "");

/** Who decides when a conflict of interest blocks the board (art. 2:129/239/291/44 lid 6 BW). */
function tbFallback(g: ReturnType<typeof governanceFacts>) {
  if (g.model === "twee") return `de ${g.toezicht}`;
  if (g.f === "stichting") return "het bestuur, onder schriftelijke vastlegging van de overwegingen";
  return `de ${g.av}, tenzij de statuten anders bepalen`;
}

const governance: Template = {
  id: "governance",
  title: "Governancemodel",
  description:
    "Leidt uit rechtsvorm, omvang en gekozen bestuursmodel de governancestructuur af: organen, taken, bevoegdhedenmatrix, structuurregime en overige wettelijke verplichtingen (Boek 2 BW).",
  sources: [
    art(2, "9"),
    art(2, "129"),
    art(2, "129a"),
    art(2, "239"),
    art(2, "239a"),
    art(2, "250"),
    art(2, "263"),
    art(2, "272"),
    art(2, "274"),
    art(2, "291"),
    art(2, "292a"),
    art(2, "44"),
    art(2, "47"),
    art(2, "63f"),
    art(2, "142b"),
    art(2, "276"),
    art(2, "397"),
    law("Wet op de ondernemingsraden, art. 2", "BWBR0002747", "2"),
    { label: "Nederlandse Corporate Governance Code", url: "https://www.mccg.nl/" },
  ],
  groups: [
    {
      title: "Organisatie",
      fields: [
        { name: "org_naam", label: "Naam", type: "text", required: true },
        {
          name: "rechtsvorm",
          label: "Rechtsvorm",
          type: "select",
          default: "bv",
          options: Object.entries(RECHTSVORM).map(([value, label]) => ({ value, label: label[0].toUpperCase() + label.slice(1) })),
        },
        {
          name: "beurs",
          label: "Aandelen/certificaten beursgenoteerd?",
          type: "select",
          default: "nee",
          options: [{ value: "nee", label: "Nee" }, { value: "ja", label: "Ja" }],
          showIf: (v) => v.rechtsvorm === "nv",
        },
        { name: "werknemers", label: "Werknemers in Nederland (incl. afhankelijke maatschappijen)", type: "number" },
        {
          name: "kapitaal",
          label: "Geplaatst kapitaal + reserves / eigen vermogen (€)",
          type: "number",
          showIf: (v) => ["bv", "nv", "cooperatie"].includes(v.rechtsvorm),
        },
        {
          name: "or",
          label: "Ondernemingsraad ingesteld (wettelijke plicht)?",
          type: "select",
          default: "nee",
          options: [{ value: "nee", label: "Nee" }, { value: "ja", label: "Ja" }],
        },
        {
          name: "vrijstelling",
          label: "Vrijstelling structuurregime (bijv. dochter van structuurvennootschap)?",
          type: "select",
          default: "nee",
          options: [{ value: "nee", label: "Nee" }, { value: "ja", label: "Ja" }],
          showIf: (v) => ["bv", "nv", "cooperatie"].includes(v.rechtsvorm),
        },
      ],
    },
    {
      title: "Bestuur",
      fields: [
        {
          name: "model",
          label: "Bestuursmodel",
          type: "select",
          default: "bestuur",
          options: [
            { value: "bestuur", label: "Alleen bestuur (geen toezichtorgaan)" },
            { value: "twee", label: "Two-tier: bestuur + raad van commissarissen / toezicht" },
            { value: "een", label: "One-tier: uitvoerende en niet-uitvoerende bestuurders" },
          ],
        },
        { name: "n_bestuur", label: "Aantal bestuurders (totaal)", type: "number", default: "2" },
        { name: "n_uitvoerend", label: "Waarvan uitvoerend", type: "number", default: "1", showIf: (v) => v.model === "een" },
        {
          name: "vertegenwoordiging",
          label: "Vertegenwoordiging",
          type: "select",
          default: "zelfstandig",
          options: [
            { value: "zelfstandig", label: "Iedere bestuurder zelfstandig" },
            { value: "twee", label: "Twee bestuurders gezamenlijk" },
            { value: "bestuur", label: "Alleen het bestuur als geheel" },
          ],
        },
        { name: "drempel", label: "Goedkeuring vereist voor transacties boven (€)", type: "number", default: "250000" },
      ],
    },
    {
      title: "Toezicht",
      fields: [
        { name: "n_toezicht", label: "Aantal commissarissen / toezichthouders", type: "number", default: "3", showIf: (v) => v.model === "twee" },
        { name: "termijn", label: "Benoemingstermijn toezichthouders (jaren)", type: "number", default: "4", showIf: (v) => v.model !== "bestuur" },
      ],
    },
    { title: "Vaststelling", fields: [{ name: "datum", label: "Datum", type: "date" }] },
  ],
  checks: (v) => {
    const g = governanceFacts(v);
    const A = govArts(g.f);
    const c: string[] = [];
    const nb = num(v.n_bestuur);
    const nu = num(v.n_uitvoerend);
    const nt = g.model === "twee" ? num(v.n_toezicht) : nb - nu;
    if (g.structuur) {
      c.push(
        `Structuurregime: geplaatst kapitaal + reserves ≥ € 16 mln, wettelijk ingestelde OR en ≥ 100 werknemers in Nederland (${a2(A.sCriteria)}). Opgaaf aan het handelsregister binnen twee maanden na vaststelling van de jaarrekening; het regime geldt na drie jaar onafgebroken inschrijving.`,
      );
      if (g.model === "bestuur") c.push(`Onder het structuurregime is een raad van commissarissen verplicht (${a2(A.sRvc)})${A.sMonistisch ? ` of een one-tier board (${a2(A.sMonistisch)})` : ""}. Kies een ander bestuursmodel.`);
      if (g.model === "een" && g.f === "cooperatie") c.push("Voor een grote coöperatie schrijft art. 2:63f BW een raad van commissarissen voor; een one-tier board is daar niet als alternatief geregeld.");
      if (g.model !== "bestuur" && nt < 3) c.push(`Onder het structuurregime bestaat het toezichtorgaan uit ten minste drie leden (${a2(`${A.sRvc} lid 2`)}).`);
      if (g.model !== "bestuur" && num(v.termijn) > 4) c.push("Onder het structuurregime treedt een commissaris uiterlijk na vier jaar af (art. 2:161/2:271 BW).");
      if (g.kapitaalvennootschap) c.push(`Check of het gemitigeerde regime geldt (internationale groep of joint venture, art. 2:${g.f === "nv" ? "155" : "265"} BW): dan benoemt de algemene vergadering de bestuurders.`);
    } else if ((g.kapitaalvennootschap || g.f === "cooperatie") && num(v.werknemers) >= 100 && v.or === "ja" && !(num(v.kapitaal) >= STRUCTUUR_GRENS) && v.vrijstelling !== "ja")
      c.push("Vul het geplaatst kapitaal + reserves in om het structuurregime te toetsen (grens € 16 mln).");
    if (g.werknemers >= 50 && v.or !== "ja") c.push("Bij ten minste 50 werknemers is de ondernemer verplicht een ondernemingsraad in te stellen (art. 2 WOR).");
    if (g.model === "een") {
      if (!(nu >= 1) || !(nb - nu >= 1)) c.push(`Een one-tier board heeft ten minste één uitvoerende en één niet-uitvoerende bestuurder (${a2(A.monistisch)}).`);
      if (nb - nu >= 1 && nb - nu <= nu) c.push("Aanbeveling: een meerderheid van niet-uitvoerende bestuurders versterkt het toezicht (vgl. Corporate Governance Code).");
    }
    if (nb === 1 && v.vertegenwoordiging === "twee") c.push("Gezamenlijke vertegenwoordiging door twee bestuurders is niet mogelijk met één bestuurder.");
    if (nb === 1) c.push(`Bij een enige bestuurder met een tegenstrijdig belang neemt ${tbFallback(g)} het besluit (${a2(`${A.taak} lid 6`)}).`);
    if (g.beurs) {
      c.push("Beursgenoteerd: pas de Nederlandse Corporate Governance Code toe (pas toe of leg uit) en laat de algemene vergadering het bezoldigingsbeleid vaststellen (art. 2:135 BW).");
      if (g.model === "twee") c.push("Ingroeiquotum: de raad van commissarissen bestaat voor ten minste een derde uit mannen en een derde uit vrouwen; benoemingen in strijd daarmee zijn nietig (art. 2:142b BW).");
    }
    if (g.kapitaalvennootschap && g.werknemers >= 250)
      c.push(`Met ≥ 250 werknemers is de vennootschap mogelijk 'groot' (art. 2:397 BW: twee van drie criteria). Dan gelden streefcijfers voor de man/vrouw-verhouding en een plan van aanpak (art. 2:${g.f === "nv" ? "166" : "276"} BW).`);
    if ((g.f === "stichting" || g.leden) && g.model !== "bestuur")
      c.push(`Neem de toezichtstructuur op in de statuten: ${g.model === "een" ? a2(A.monistisch) : a2(A.rvc)} (WBTR).`);
    c.push(`Neem in de statuten een regeling op voor ontstentenis of belet van alle bestuurders (${a2(A.obBestuur)})${g.model === "twee" ? ` en commissarissen (${a2(A.obRvc)})` : ""}.`);
    return c;
  },
  render: (v) => {
    const g = governanceFacts(v);
    const A = govArts(g.f);
    const naam = blank(v.org_naam, "[naam]");
    const nb = blank(v.n_bestuur, "[aantal]");
    const nu = num(v.n_uitvoerend);
    const drempel = eur(v.drempel);
    const goedkeurder = g.structuur || g.model !== "bestuur" ? `de ${g.toezicht}` : g.av ? `de ${g.av}` : "";
    const vert = {
      zelfstandig: "het bestuur en iedere bestuurder afzonderlijk",
      twee: "het bestuur en twee bestuurders gezamenlijk",
      bestuur: "uitsluitend het bestuur als geheel",
    }[v.vertegenwoordiging || "zelfstandig"];
    const organen = [
      g.av && `- De ${g.av} (${g.leden ? "leden" : "aandeelhouders"}).`,
      g.model === "een"
        ? `- Het bestuur, bestaande uit uitvoerende en niet-uitvoerende bestuurders (${a2(A.monistisch)}).`
        : "- Het bestuur.",
      g.model === "twee" && `- De ${g.toezicht} (${a2(g.structuur ? A.sRvc : A.rvc)}).`,
      v.or === "ja" && "- De ondernemingsraad (medezeggenschap, Wet op de ondernemingsraden).",
    ].filter(Boolean);

    const parts = [
      `# Governancemodel ${naam}`,
      `${naam} is een ${RECHTSVORM[g.f]} naar Nederlands recht. Dit document beschrijft de organen, hun taken en bevoegdheden en de besluitvorming. Het vormt de basis voor de statuten en de reglementen van bestuur${g.model !== "bestuur" ? " en toezicht" : ""}.`,
      "## 1. Organen",
      organen.join("\n"),
      "## 2. Bestuur",
      `Het bestuur is belast met het besturen van ${naam} en richt zich naar het belang van de ${g.kapitaalvennootschap ? "vennootschap en de met haar verbonden onderneming" : `${g.f} en de met haar verbonden organisatie`} (${a2(A.taak)}). Iedere bestuurder is gehouden tot een behoorlijke vervulling van zijn taak en draagt verantwoordelijkheid voor de algemene gang van zaken (art. 2:9 BW).`,
      g.model === "een"
        ? `Het bestuur bestaat uit ${nb} bestuurders, van wie ${isNaN(nu) ? "[aantal]" : nu} uitvoerend en ${isNaN(nu) || isNaN(num(v.n_bestuur)) ? "[aantal]" : num(v.n_bestuur) - nu} niet-uitvoerend. De niet-uitvoerende bestuurders houden toezicht op de taakuitoefening door de bestuurders; het voorzitterschap, de voordracht voor benoeming van bestuurders en de vaststelling van de bezoldiging van uitvoerende bestuurders liggen bij hen (${a2(A.monistisch)}).`
        : `Het bestuur bestaat uit ${nb} ${num(v.n_bestuur) === 1 ? "bestuurder" : "bestuurders"}. Het bestuur stelt een bestuursreglement vast met de taakverdeling, vergaderorde en besluitvorming.`,
      `Vertegenwoordiging: ${naam} wordt vertegenwoordigd door ${vert} (${a2(A.vert)}).`,
      `Tegenstrijdig belang: een bestuurder neemt niet deel aan de beraadslaging en besluitvorming bij een direct of indirect persoonlijk belang dat tegenstrijdig is met het belang van ${naam}. Kan daardoor geen bestuursbesluit worden genomen, dan besluit ${tbFallback(g)} (${a2(`${A.taak} lid 6`)}).`,
      `Ontstentenis of belet: de statuten regelen hoe in de taken en bevoegdheden voorlopig wordt voorzien als alle bestuurders ontbreken of verhinderd zijn (${a2(A.obBestuur)}).`,
    ];

    if (g.model !== "bestuur") {
      parts.push(
        "## 3. Toezicht",
        g.model === "twee"
          ? `De ${g.toezicht} houdt toezicht op het beleid van het bestuur en de algemene gang van zaken en staat het bestuur met raad terzijde (${a2(A.rvc)}). De raad bestaat uit ${blank(v.n_toezicht, "[aantal]")} natuurlijke personen. Een lid neemt niet deel aan beraadslaging en besluitvorming bij een tegenstrijdig belang (${a2(A.tbRvc)}).`
          : `Het toezicht ligt bij de niet-uitvoerende bestuurders binnen het bestuur (${a2(A.monistisch)}). Zij zijn natuurlijke personen en vergaderen ook buiten aanwezigheid van de uitvoerende bestuurders over het functioneren van het bestuur.`,
        `Leden van het toezichtorgaan worden benoemd voor een termijn van ${blank(v.termijn, "[aantal]")} jaar${g.structuur ? " (onder het structuurregime ten hoogste vier jaar)" : ""}. ${g.model === "twee" ? "De raad stelt" : "De niet-uitvoerende bestuurders stellen"} een profielschets en een reglement vast.`,
      );
    }

    const n = (i: number) => (g.model !== "bestuur" ? i + 1 : i);
    const rows: string[] = [];
    const benoemer = g.structuur && A.sBenoeming ? `de ${g.toezicht} (${a2(g.model === "een" ? A.sMonistisch : A.sBenoeming)}; de ${g.av} wordt vooraf in kennis gesteld)` : g.f === "stichting" ? `het orgaan dat de statuten aanwijzen (${a2(A.benoeming)})` : `de ${g.av} (${a2(A.benoeming)})`;
    rows.push(`Benoeming, schorsing en ontslag bestuurders: ${benoemer}.`);
    if (g.model !== "bestuur") rows.push(`Benoeming toezichthouders: ${g.structuur ? `de ${g.av} op voordracht van de raad van commissarissen, met aanbevelingsrecht en versterkt aanbevelingsrecht van de ondernemingsraad (${a2(A.sRvc)})` : g.f === "stichting" ? "het orgaan dat de statuten aanwijzen" : `de ${g.av}`}.`);
    rows.push(`Opmaken jaarrekening: het bestuur. Vaststelling: ${g.f === "stichting" ? "het orgaan dat de statuten aanwijzen" : `de ${g.av}`} (${a2(A.jaarrekening)}).`);
    if (g.f === "bv") rows.push("Winstbestemming en uitkeringen: de algemene vergadering; het bestuur keurt een uitkering alleen goed als de vennootschap daarna haar opeisbare schulden kan blijven betalen (art. 2:216 BW).");
    if (g.f === "nv") rows.push("Belangrijke verandering van identiteit of karakter (o.a. overdracht van de onderneming, belangrijke deelnemingen): goedkeuring van de algemene vergadering (art. 2:107a BW).");
    rows.push(`Statutenwijziging: ${g.f === "stichting" ? "alleen als de statuten die mogelijkheid openen, bij notariële akte" : `de ${g.av}`} (${a2(A.statuten)}).`);
    if (g.structuur) rows.push(`Wettelijke goedkeuringsbesluiten (o.a. uitgifte van aandelen en schuldbrieven, duurzame samenwerking, grote investeringen en reorganisaties): goedkeuring van de ${g.model === "een" ? "meerderheid van de niet-uitvoerende bestuurders" : "raad van commissarissen"} (${a2(A.sGoedkeuring)}).`);
    if (goedkeurder) rows.push(`Transacties, investeringen en financieringen boven ${drempel}: voorafgaande goedkeuring van ${goedkeurder}, vast te leggen in de statuten en het bestuursreglement.`);
    rows.push("Overige besluiten: het bestuur, binnen de begroting en het vastgestelde beleid.");

    parts.push(`## ${n(3)}. Bevoegdhedenmatrix`, rows.map((r) => `- ${r}`).join("\n"));

    const overig: string[] = [];
    if (g.structuur) overig.push(`Structuurregime van toepassing (${a2(A.sCriteria)}): ${g.kapitaalvennootschap ? "verplichte raad van commissarissen of one-tier board, benoeming van bestuurders door het toezichtorgaan en wettelijke goedkeuringsrechten." : "verplichte raad van commissarissen en wettelijke goedkeuringsrechten; de algemene ledenvergadering blijft bestuurders benoemen."}`);
    if (v.or === "ja") overig.push("Ondernemingsraad: advies- en instemmingsrechten op grond van de WOR (art. 25 en 27 WOR).");
    if (g.beurs) overig.push("Nederlandse Corporate Governance Code (pas toe of leg uit), bezoldigingsbeleid (art. 2:135 BW) en ingrijpende besluiten via de algemene vergadering.");
    if (g.kapitaalvennootschap && g.werknemers >= 250) overig.push(`Mogelijk 'grote' vennootschap: streefcijfers man/vrouw-verhouding en plan van aanpak (art. 2:${g.f === "nv" ? "166" : "276"} BW).`);
    if (overig.length) parts.push(`## ${n(4)}. Wettelijke verplichtingen`, overig.map((r) => `- ${r}`).join("\n"));

    parts.push(`Vastgesteld door het bestuur${g.model === "twee" ? ` en goedgekeurd door de ${g.toezicht}` : ""} op ${fmtDate(v.datum)}.`);
    return parts.join("\n\n");
  },
};

export const GOVERNANCE: Template[] = [governance];
