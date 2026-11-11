import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { CITY_CONFIG } from "../city";

const router: IRouter = Router();
export const DISH_INSPIRATION_QUERY = `${CITY_CONFIG.name} ${CITY_CONFIG.favoriteDish}`;
const APP_NAME = "gateway_city_guide";
const MISSING_KEY = "Food inspiration is not configured yet. Add UNSPLASH_ACCESS_KEY to Replit Secrets to enable it.";

// Validate provider data before using it as a link or image source.
function isTrustedUrl(value: string, hostname: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === hostname &&
      !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}
const imageUrl = z.string().url().refine(value => isTrustedUrl(value, "images.unsplash.com"));
const profileUrl = z.string().url().refine(value => isTrustedUrl(value, "unsplash.com"));
const downloadLocation = z.string().url().refine(value => {
  if (!isTrustedUrl(value, "api.unsplash.com")) return false;
  return /^\/photos\/[A-Za-z0-9_-]+\/download$/.test(new URL(value).pathname);
});
const photoSchema = z.object({
  id: z.string().min(1),
  alt_description: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  urls: z.object({ regular: imageUrl, raw: imageUrl }),
  user: z.object({ name: z.string().min(1), links: z.object({ html: profileUrl }) }),
  links: z.object({ download_location: downloadLocation }),
});

function withAttribution(value: string): string {
  const url = new URL(value);
  url.searchParams.set("utm_source", APP_NAME);
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

function cleanDownloadLocation(value: string): string {
  const original = new URL(value);
  const url = new URL(original.pathname, "https://api.unsplash.com");
  // Preserve Unsplash's tracking identifier, without accepting auth parameters.
  const ixid = original.searchParams.get("ixid");
  if (ixid) url.searchParams.set("ixid", ixid);
  return url.toString();
}

async function requestUnsplash(url: URL | string, apiKey: string) {
  return fetch(url, {
    headers: { Authorization: `Client-ID ${apiKey}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(10_000),
    // Never forward the access key to a redirect destination.
    redirect: "error",
  });
}

function providerError(res: Response, status: number): void {
  if (status === 401) {
    res.status(503).json({ error: "Food inspiration could not connect. Check that UNSPLASH_ACCESS_KEY is a valid Unsplash Access Key in Replit Secrets." });
  } else if (status === 403 || status === 429) {
    res.status(503).json({ error: "Unsplash is unavailable or has reached its request limit. Please try again later." });
  } else {
    res.status(502).json({ error: "Food inspiration could not load from Unsplash. Please try again in a moment." });
  }
}

router.get("/unsplash/dish-inspiration", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const apiKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: MISSING_KEY });
    return;
  }
  try {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", DISH_INSPIRATION_QUERY);
    url.searchParams.set("per_page", "6");
    url.searchParams.set("content_filter", "high");
    const response = await requestUnsplash(url, apiKey);
    if (!response.ok) {
      providerError(res, response.status);
      return;
    }
    const data = z.object({ results: z.array(z.unknown()) }).parse(await response.json());
    const photos = data.results.flatMap(value => {
      const parsed = photoSchema.safeParse(value);
      if (!parsed.success) return [];
      const photo = parsed.data;
      return [{
        id: photo.id,
        imageUrl: photo.urls.regular,
        rawUrl: photo.urls.raw,
        altText: photo.alt_description || photo.description || `Food inspiration for ${DISH_INSPIRATION_QUERY}`,
        photographerName: photo.user.name,
        photographerProfileUrl: withAttribution(photo.user.links.html),
        downloadLocation: cleanDownloadLocation(photo.links.download_location),
      }];
    }).slice(0, 6);
    res.json(photos);
  } catch {
    // Avoid logging provider requests, which include server credentials.
    res.status(502).json({ error: "Food inspiration could not reach Unsplash. Please try again in a moment." });
  }
});

// Browsers never need the access key. Only this server calls download_location.
router.post("/unsplash/dish-inspiration/download", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const apiKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: MISSING_KEY });
    return;
  }
  const body = z.object({ downloadLocation }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose a valid Unsplash inspiration photo." });
    return;
  }
  try {
    const response = await requestUnsplash(cleanDownloadLocation(body.data.downloadLocation), apiKey);
    if (!response.ok) {
      providerError(res, response.status);
      return;
    }
    res.status(204).end();
  } catch {
    res.status(502).json({ error: "That photo could not be opened just now. Please try again." });
  }
});

export default router;
