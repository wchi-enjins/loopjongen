# Juridische werkplek (MVP)

A web app for lawyers, based on Dutch law. Next.js 16 (TypeScript), PostgreSQL, Docker.

## Start

*Dev with container* 
```bash
docker compose up -d --build
```

Open http://localhost:3000.

- Keys are read at runtime through `env_file`: `ANTHROPIC_API_KEY` from `.env` in this folder. They are never copied into the image or stored in the database. See `.env.example`.
- Chat, document analyses and "Aanvullende feiten verwerken met AI" on `/genereren`: Claude Opus 5.5 (`claude-opus-5-5`, effort `low`), key `ANTHROPIC_API_KEY`. Override with `ANTHROPIC_MODEL`.
- PostgreSQL runs on `localhost:5433` (user/password/db: `legal`). The schema is created automatically when the app starts.


*Local development without container*

Once: `npm --prefix app install` and `direnv allow` (`.envrc` loads `.env` and sets `DATABASE_URL`). Rerun `npm --prefix app install` only when `package.json` changes.
```bash
docker compose up -d db && npm --prefix app run dev
```

If the app shows no data or can't connect to the database, the `db` container is probably an old one that doesn't publish port 5433 (check with `docker port loopjongen-db-1`; it should print `5432/tcp -> 0.0.0.0:5433`). Recreate it. Your data lives in the `loopjongen_pgdata` volume, so it is kept:
```bash
docker compose up -d --force-recreate db
```

## Pages

| Page | Function |
| --- | --- |
| `/` | AI chat. Conversations are saved in Postgres; documents can be attached per conversation as context. Answers are streamed. Before each answer the relevant law articles are looked up and given to the model, with links under the answer. The search method is a setting per chat ("Wetgeving: A/B/C", default B; see `model-improvements/law-retrieval.md`). B needs the local index (`node scripts/bwb-sync.ts`, then `benchmarks/law-retrieval/b-fulltext/index.ts`); C needs `data/bwb/manifest.json`. |
| `/documenten` | Upload PDF/DOCX/TXT/images, preview them (PDF viewer, DOCX as HTML, images) and view the extracted text. Buttons start an analysis in the chat (`/`): summary, legal analysis, risks, deadlines. |
| `/genereren` | Six common documents: employment contract, residential lease, NDA, power of attorney, reminder/notice of default (14-day letter), settlement agreement. Fill parties from a customer (Klanten), save and reopen drafts per customer, live preview, extra facts processed by AI and an AI check of the draft (both get per-document drafting rules plus the current text of the cited BW articles), export to .docx, saving to Documents, printing/PDF. |
| `/instellingen` | Per template: firm default values for the form, own standard clauses added to every document, and the clause texts (`{{placeholders}}` are filled from the form); saved in Postgres. |
| `/recordings` | Meetings recorded in the Granola app, read through the Granola MCP server. "Verbind met Granola" logs in via the browser (OAuth, no API key); the login is stored in Postgres. Import notes (+ transcript on paid plans) as a Markdown document, or open it straight in the chat as context. |
| `/zoeken` | Laws and regulations in force via the SRU API of wetten.overheid.nl, with the full text article by article from the BWB repository (deep link per article). Case law via rechtspraak.nl (search, plus full text via the open data API; also direct ECLI lookup). |

## Sources

- Laws and regulations: `zoekservice.overheid.nl/sru/Search` (x-connection=BWB) and `repository.officiele-overheidspublicaties.nl/bwb/…` (KOOP).
- Case law, full text: `data.rechtspraak.nl/uitspraken/content?id=ECLI:…` (official open data).
- Case law, search: `uitspraken.rechtspraak.nl/api/zoek`. This is the search API behind the rechtspraak.nl website and is not formally documented, so it may change.

- Meetings: Granola MCP server `mcp.granola.ai/mcp` (recording itself happens in the Granola app).

## Structure

```
docker-compose.yml        db (postgres:17) + app
app/src/lib/              db, ai, extract (pdf/docx), templates, docx, wetten, rechtspraak
app/src/app/api/          route handlers (conversations, documents, generate, wetten, rechtspraak)
app/src/app/{chat,documenten,genereren,zoeken}/page.tsx
```

Out of scope (by design): authentication, OCR for scanned PDFs.
