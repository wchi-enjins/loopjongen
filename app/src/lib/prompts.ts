export const ANALYSIS_PROMPTS = [
  {
    label: "Samenvatting",
    prompt: "Geef een beknopte samenvatting van het bijgevoegde document: soort document, partijen, kern van de inhoud en belangrijkste data en bedragen.",
  },
  {
    label: "Juridische analyse",
    prompt:
      "Analyseer het bijgevoegde document naar Nederlands recht: juridische kwalificatie, relevante wetsartikelen, geldigheid van de belangrijkste bepalingen en eventuele strijd met dwingend recht.",
  },
  {
    label: "Risico's en aandachtspunten",
    prompt: "Welke juridische risico's, onduidelijkheden en ontbrekende bepalingen bevat het bijgevoegde document? Geef per punt een concreet verbetervoorstel.",
  },
  {
    label: "Termijnen en verplichtingen",
    prompt: "Zet alle termijnen, deadlines en verplichtingen per partij uit het bijgevoegde document in een tabel, met vindplaats in het document.",
  },
];
