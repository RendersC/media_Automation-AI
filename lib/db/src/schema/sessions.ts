import { pgTable, text, serial, integer, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { directoriesTable } from "./directories";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  programName: text("program_name").notNull(),
  broadcastDate: text("broadcast_date").notNull(),
  status: text("status").notNull().default("draft"),
  directoryId: integer("directory_id").references(() => directoriesTable.id, { onDelete: "set null" }),
  broadcastText: text("broadcast_text"),
  youtubeUrl: text("youtube_url"),
  videoUrl: text("video_url"),
  progressMessage: text("progress_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;

export const segmentsTable = pgTable("segments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  speaker: text("speaker"),
  timeStart: text("time_start").notNull(),
  timeEnd: text("time_end").notNull(),
  durationMinutes: real("duration_minutes").notNull().default(0),
  source: text("source").notNull().default("broadcast"),
  categoryIds: integer("category_ids").array().notNull().default([]),
  aiSuggested: integer("ai_suggested").notNull().default(0),
  manuallyEdited: integer("manually_edited").notNull().default(0),
});

export const insertSegmentSchema = createInsertSchema(segmentsTable).omit({ id: true });
export type InsertSegment = z.infer<typeof insertSegmentSchema>;
export type Segment = typeof segmentsTable.$inferSelect;
