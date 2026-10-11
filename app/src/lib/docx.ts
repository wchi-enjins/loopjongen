import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

function lines(text: string, bold = false) {
  return text.split("\n").map((l, i) => new TextRun({ text: l, bold, break: i > 0 ? 1 : 0 }));
}

function signatureTable(spec: string) {
  const cells = spec.split("||").map((s) => s.trim());
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({
        children: cells.map(
          (c) =>
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
              children: [
                new Paragraph({ spacing: { before: 200, after: 800 }, children: lines(c.split("\n")[0] ?? "", true) }),
                new Paragraph({ children: [new TextRun("______________________________")] }),
                new Paragraph({ children: lines(c.split("\n").slice(1).join("\n")) }),
              ],
            }),
        ),
      }),
    ],
  });
}

/** Convert the template markup (see templates.ts) into a .docx buffer. */
export async function markupToDocx(markup: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const block of markup.replace(/\r/g, "").split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    if (b.startsWith("# ")) {
      children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: b.slice(2), bold: true, size: 32, color: "000000" })] }));
    } else if (b.startsWith("## ")) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: b.slice(3), bold: true, size: 24, color: "000000" })] }));
    } else if (b.startsWith("SIGN:")) {
      children.push(signatureTable(b.slice(5)));
    } else {
      children.push(new Paragraph({ spacing: { after: 160 }, children: lines(b) }));
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 21 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
