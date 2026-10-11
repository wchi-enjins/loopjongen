import { db } from "@/lib/db";
import { NotConnectedError, callText, logout, parseMeetings, withGranola } from "@/lib/granola";

/** Connection status, the Granola account and the user's own meetings of the last year. */
export async function GET() {
  try {
    const { account, list } = await withGranola(async (c) => ({
      account: await callText(c, "get_account_info"),
      list: await callText(c, "list_meetings", {
        time_range: "custom",
        custom_start: new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10),
        custom_end: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
        // Meetings the user recorded or took part in, not every Team Space note of colleagues.
        involvement: { captured_by_me: true, listed_as_participant: true },
      }),
    }));
    const meetings = parseMeetings(list);
    const { rows } = await (await db()).query(`SELECT id, external_id FROM documents WHERE external_id = ANY($1)`, [
      meetings.map((m) => m.id),
    ]);
    const docs = new Map(rows.map((r) => [r.external_id, r.id]));
    let label = account;
    try {
      const info = JSON.parse(account.slice(account.indexOf("{")));
      label = [info.email, info.active_workspace?.display_name].filter(Boolean).join(" · ");
    } catch {}
    return Response.json({
      connected: true,
      account: label,
      meetings: meetings.map((m) => ({ id: m.id, title: m.title, date: m.date, document_id: docs.get(m.id) ?? null })),
    });
  } catch (err) {
    if (err instanceof NotConnectedError) return Response.json({ connected: false, meetings: [] });
    return Response.json({ error: err instanceof Error ? err.message : "Granola niet bereikbaar" }, { status: 502 });
  }
}

/** Disconnect: forget the Granola login. */
export async function DELETE() {
  await logout();
  return Response.json({ ok: true });
}
