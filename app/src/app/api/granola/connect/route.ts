import { APP_URL, startLogin } from "@/lib/granola";

/** Sends the browser to the Granola login (or straight back when already connected). */
export async function GET() {
  try {
    const url = await startLogin();
    return Response.redirect(url ?? `${APP_URL}/recordings`, 302);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verbinden mislukt";
    return Response.redirect(`${APP_URL}/recordings?error=${encodeURIComponent(msg)}`, 302);
  }
}
