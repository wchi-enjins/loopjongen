import { APP_URL, finishLogin } from "@/lib/granola";

/** Granola redirects here after login with ?code=…&state=… */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  try {
    if (!code) throw new Error(params.get("error_description") || params.get("error") || "Geen inlogcode ontvangen");
    await finishLogin(code, params.get("state"));
    return Response.redirect(`${APP_URL}/recordings`, 302);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Inloggen mislukt";
    return Response.redirect(`${APP_URL}/recordings?error=${encodeURIComponent(msg)}`, 302);
  }
}
