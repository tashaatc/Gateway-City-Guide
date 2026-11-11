import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import router, { DISH_INSPIRATION_QUERY } from "../src/routes/unsplash";

const providerFetch = vi.fn();
const realFetch = globalThis.fetch;
const location = "https://api.unsplash.com/photos/test-photo/download?ixid=keep-me";
const fixture = (id: number) => ({
  id: `photo-${id}`,
  alt_description: "Golden ravioli on a plate",
  description: null,
  urls: {
    regular: `https://images.unsplash.com/photo-${id}?ixid=keep-me&w=1080`,
    raw: `https://images.unsplash.com/photo-${id}?ixid=keep-me`,
  },
  user: { name: "Test Photographer", links: { html: "https://unsplash.com/@tester?existing=value" } },
  links: { download_location: location },
});
let server: Server;
let base: string;
beforeAll(async () => {
  vi.stubGlobal("fetch", providerFetch);
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}/api/unsplash/dish-inspiration`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  providerFetch.mockReset();
  vi.stubEnv("UNSPLASH_ACCESS_KEY", "test-private-key");
});
async function get() {
  const response = await realFetch(base);
  return { status: response.status, body: await response.json() };
}
async function track(downloadLocation = location) {
  return realFetch(`${base}/download`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ downloadLocation }) });
}

describe("Unsplash food inspiration", () => {
  it("builds the configured dish query and maps at most six attributed, hotlinked photos", async () => {
    providerFetch.mockResolvedValue(Response.json({ results: Array.from({ length: 8 }, (_, i) => fixture(i)) }));
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(6);
    const [url, options] = providerFetch.mock.calls[0];
    expect(url.origin + url.pathname).toBe("https://api.unsplash.com/search/photos");
    expect(url.searchParams.get("query")).toBe(DISH_INSPIRATION_QUERY);
    expect(DISH_INSPIRATION_QUERY).toBe("St. Louis toasted ravioli");
    expect(url.searchParams.get("per_page")).toBe("6");
    expect(options.headers.Authorization).toBe("Client-ID test-private-key");
    expect(options.redirect).toBe("error");
    expect(Object.keys(result.body[0]).sort()).toEqual(["id", "imageUrl", "rawUrl", "altText", "photographerName", "photographerProfileUrl", "downloadLocation"].sort());
    expect(result.body[0].imageUrl).toBe(fixture(0).urls.regular);
    expect(result.body[0].rawUrl).toBe(fixture(0).urls.raw);
    expect(result.body[0].photographerProfileUrl).toContain("utm_source=gateway_city_guide");
    expect(result.body[0].photographerProfileUrl).toContain("utm_medium=referral");
    expect(JSON.stringify(result.body)).not.toContain("test-private-key");
    expect(providerFetch).toHaveBeenCalledOnce(); // Rendering is not a download.
  });
  it("returns a friendly 503 and makes no provider calls without the key", async () => {
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "   ");
    const result = await get();
    expect(result.status).toBe(503);
    expect(result.body.error).toContain("UNSPLASH_ACCESS_KEY");
    expect((await track()).status).toBe(503);
    expect(providerFetch).not.toHaveBeenCalled();
  });
  it.each([0, 2])("handles %s search results without inventing photos", async count => {
    providerFetch.mockResolvedValue(Response.json({ results: Array.from({ length: count }, (_, i) => fixture(i)) }));
    expect((await get()).body).toHaveLength(count);
  });
  it("omits malformed or unsafe provider links", async () => {
    const unsafe = fixture(1);
    unsafe.user.links.html = "javascript:alert(1)";
    providerFetch.mockResolvedValue(Response.json({ results: [unsafe, fixture(2)] }));
    expect((await get()).body).toHaveLength(1);
  });
  it("uses the description when alt text is missing", async () => {
    providerFetch.mockResolvedValue(Response.json({ results: [{ ...fixture(0), alt_description: null, description: "Dinner plate" }] }));
    expect((await get()).body[0].altText).toBe("Dinner plate");
  });
  it("calls the returned download location with its ixid and server credentials", async () => {
    providerFetch.mockResolvedValue(Response.json({ url: "https://images.unsplash.com/example" }));
    expect((await track()).status).toBe(204);
    expect(providerFetch.mock.calls[0][0]).toBe(location);
    expect(providerFetch.mock.calls[0][1].headers.Authorization).toBe("Client-ID test-private-key");
  });
  it.each([
    "https://attacker.example/photos/test/download",
    "http://api.unsplash.com/photos/test/download",
    "https://api.unsplash.com@attacker.example/photos/test/download",
    "https://api.unsplash.com/search/photos",
    "https://api.unsplash.com/photos/test/download/extra",
    "https://api.unsplash.com:8443/photos/test/download",
    "https://user:password@api.unsplash.com/photos/test/download",
  ])("rejects arbitrary download destinations: %s", async value => {
    expect((await track(value)).status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });
  it("strips client-supplied authentication parameters from download URLs", async () => {
    providerFetch.mockResolvedValue(new Response(null, { status: 200 }));
    expect((await track(`${location}&client_id=untrusted`)).status).toBe(204);
    expect(providerFetch.mock.calls[0][0]).toBe(location);
  });
  it.each([401, 403, 429, 500])("handles provider status %s without leaking details", async status => {
    providerFetch.mockResolvedValue(new Response("sensitive provider body", { status }));
    const result = await get();
    expect(result.status).toBe(status === 500 ? 502 : 503);
    expect(result.body.error).not.toContain("sensitive");
  });
  it("reports network failures during search and tracking", async () => {
    providerFetch.mockRejectedValue(new Error("network with private data"));
    expect((await get()).status).toBe(502);
    expect((await track()).status).toBe(502);
  });
  it("reports malformed provider JSON", async () => {
    providerFetch.mockResolvedValue(Response.json({ results: null }));
    expect((await get()).status).toBe(502);
  });
});
