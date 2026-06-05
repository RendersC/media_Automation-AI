import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const directoriesTable = pgTable("directories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDirectorySchema = createInsertSchema(directoriesTable).omit({ id: true, createdAt: true });
export type InsertDirectory = z.infer<typeof insertDirectorySchema>;
export type Directory = typeof directoriesTable.$inferSelect;

export const categoriesTable = pgTable("categories", {
  id: serial("id").primaryKey(),
  directoryId: integer("directory_id").notNull().references(() => directoriesTable.id, { onDelete: "cascade" }),
  code: text("code"),
  title: text("title").notNull(),
});

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;
