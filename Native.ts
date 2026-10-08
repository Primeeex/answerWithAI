import { IpcMainInvokeEvent, net } from "electron";

// Runs in Electron's main (Node) process, so Discord's page CSP doesn't apply.
// NOTE: this file MUST be named `native.ts` (lowercase) for Vencord to pick it up.
//
// Uses Electron's net.fetch (Chromium network stack: system proxy settings,
// browser-like TLS) instead of Node's fetch, which Google's front end was
// rejecting with an HTML 403 page even though the same key works in a browser.
export async function makeGeminiRequest(
    _: IpcMainInvokeEvent,
    apiKey: string,
    model: string,
    prompt: string
) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const doFetch: typeof fetch = (net as any)?.fetch ? (net as any).fetch.bind(net) : fetch;

    try {
        const res = await doFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }], role: "user" }],
            }),
        });

        // Read as text first so a non-JSON response (HTML error page from a
        // proxy, firewall, etc.) doesn't hide the real status code.
        const raw = await res.text();
        try {
            return { status: res.status, data: JSON.parse(raw) };
        } catch {
            return {
                status: res.status,
                data: `Non-JSON response from ${new URL(url).host} (content-type: ${res.headers.get("content-type")}): ${raw.slice(0, 300)}`,
            };
        }
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}