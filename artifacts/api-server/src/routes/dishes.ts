import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  CreateDishPhotoBody,
  CreateDishPhotoResponse,
  GetDishPhotoImageParams,
  ListDishPhotosResponse,
} from "@workspace/api-zod";
import { db, dishPhotosTable } from "@workspace/db";

import { inspectDish } from "../agents/dishInspector";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function dataUrlToImage(
  dataUrl: string,
): { mimeType: string; base64: string; bytes: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dataUrl,
  );
  if (!match) return null;

  const [, mimeType, base64] = match;
  if (!ALLOWED_IMAGE_TYPES.has(mimeType) || base64.length % 4 !== 0) {
    return null;
  }

  const bytes = Buffer.from(base64, "base64");
  // Buffer.from is permissive; the round trip rejects malformed base64.
  if (bytes.toString("base64") !== base64) return null;
  return { mimeType, base64, bytes };
}

function toDishPhotoResponse(photo: {
  id: number;
  title: string;
  caption: string;
  mimeType: string;
  inspectorNote: string | null;
  createdAt: Date;
}) {
  return {
    id: photo.id,
    title: photo.title,
    caption: photo.caption,
    mimeType: photo.mimeType,
    inspectorNote: photo.inspectorNote,
    createdAt: photo.createdAt.toISOString(),
    imageUrl: `/api/dishes/${photo.id}/image`,
  };
}

router.get("/dishes", async (_req, res): Promise<void> => {
  const photos = await db
    .select({
      id: dishPhotosTable.id,
      title: dishPhotosTable.title,
      caption: dishPhotosTable.caption,
      mimeType: dishPhotosTable.mimeType,
      inspectorNote: dishPhotosTable.inspectorNote,
      createdAt: dishPhotosTable.createdAt,
    })
    .from(dishPhotosTable)
    .orderBy(desc(dishPhotosTable.createdAt), desc(dishPhotosTable.id));

  // Keep the public gallery fresh across visitors and newly uploaded photos.
  res.setHeader("Cache-Control", "no-store");
  res.json(ListDishPhotosResponse.parse(photos.map(toDishPhotoResponse)));
});

router.post("/dishes", async (req, res): Promise<void> => {
  const parsed = CreateDishPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Add a title and choose a JPEG, PNG, or WebP photo.",
    });
    return;
  }

  const title = parsed.data.title.trim();
  if (!title) {
    res.status(400).json({ error: "Add a title for your dish photo." });
    return;
  }

  const image = dataUrlToImage(parsed.data.image);
  if (!image) {
    res.status(400).json({
      error: "Choose a JPEG, PNG, or WebP image file.",
    });
    return;
  }

  if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
    res.status(413).json({
      error: "This image is too large. Choose an image no larger than 3 MB.",
    });
    return;
  }

  let inspection;
  try {
    inspection = await inspectDish(`data:${image.mimeType};base64,${image.base64}`);
  } catch {
    // Do not log image data or provider errors that could contain the upload.
    req.log.error("Dish inspector request failed");
    res.status(502).json({
      error: "The dish inspector is unavailable right now. Your photo was not saved. Please try again in a moment.",
    });
    return;
  }

  // Our code, rather than the model, enforces the approval threshold.
  if (!inspection.isMatch || inspection.confidence < 0.7) {
    res.status(422).json({
      error: "Only toasted ravioli photos can be uploaded!",
      reason: `The inspector saw: ${inspection.whatISee}`,
    });
    return;
  }

  const [savedPhoto] = await db
    .insert(dishPhotosTable)
    .values({
      title,
      caption: parsed.data.caption?.trim() ?? "",
      mimeType: image.mimeType,
      imageBase64: image.base64,
      inspectorNote: `Inspector: looks like toasted ravioli (${Math.round(inspection.confidence * 100)}% sure)`,
    })
    .returning({
      id: dishPhotosTable.id,
      title: dishPhotosTable.title,
      caption: dishPhotosTable.caption,
      mimeType: dishPhotosTable.mimeType,
      inspectorNote: dishPhotosTable.inspectorNote,
      createdAt: dishPhotosTable.createdAt,
    });

  res
    .status(201)
    .json(CreateDishPhotoResponse.parse(toDishPhotoResponse(savedPhoto)));
});

router.get("/dishes/:id/image", async (req, res): Promise<void> => {
  const params = GetDishPhotoImageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "That dish photo ID is invalid." });
    return;
  }

  const [photo] = await db
    .select({
      mimeType: dishPhotosTable.mimeType,
      imageBase64: dishPhotosTable.imageBase64,
    })
    .from(dishPhotosTable)
    .where(eq(dishPhotosTable.id, params.data.id));

  if (!photo) {
    res.status(404).json({ error: "Dish photo not found." });
    return;
  }

  res.setHeader("Content-Type", photo.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(Buffer.from(photo.imageBase64, "base64"));
});

export default router;
