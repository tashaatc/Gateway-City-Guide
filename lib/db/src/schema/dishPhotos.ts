import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const dishPhotosTable = pgTable("dish_photos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  caption: text("caption").notNull().default(""),
  mimeType: text("mime_type").notNull(),
  imageBase64: text("image_base64").notNull(),
  inspectorNote: text("inspector_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertDishPhotoSchema = createInsertSchema(dishPhotosTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDishPhoto = z.infer<typeof insertDishPhotoSchema>;
export type DishPhoto = typeof dishPhotosTable.$inferSelect;
