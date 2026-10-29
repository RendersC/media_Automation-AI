import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, directoriesTable, categoriesTable } from "@workspace/db";
import {
  CreateDirectoryBody,
  GetDirectoryParams,
  ListCategoriesParams,
  DeleteDirectoryParams,
} from "@workspace/api-zod";
import { parseCategories } from "../lib/categoryParser";

const router: IRouter = Router();

router.get("/directories", async (_req, res): Promise<void> => {
  const dirs = await db.select().from(directoriesTable).orderBy(directoriesTable.createdAt);
  // One grouped count instead of loading every category of every directory.
  const counts = await db
    .select({ directoryId: categoriesTable.directoryId, count: count() })
    .from(categoriesTable)
    .groupBy(categoriesTable.directoryId);
  const countByDir = new Map(counts.map((c) => [c.directoryId, Number(c.count)]));
  const result = dirs.map((d) => ({
    id: d.id,
    name: d.name,
    year: d.year,
    categoriesCount: countByDir.get(d.id) ?? 0,
    createdAt: d.createdAt.toISOString(),
  }));
  res.json(result);
});

router.post("/directories", async (req, res): Promise<void> => {
  const parsed = CreateDirectoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, year, rawText } = parsed.data;

  const [dir] = await db.insert(directoriesTable).values({ name, year, rawText }).returning();

  const categories = parseCategories(rawText);
  if (categories.length > 0) {
    await db.insert(categoriesTable).values(
      categories.map((c) => ({ directoryId: dir.id, code: c.code ?? null, title: c.title }))
    );
  }

  const cats = await db.select().from(categoriesTable).where(eq(categoriesTable.directoryId, dir.id));

  res.status(201).json({
    id: dir.id,
    name: dir.name,
    year: dir.year,
    categoriesCount: cats.length,
    createdAt: dir.createdAt.toISOString(),
  });
});

router.get("/directories/:id", async (req, res): Promise<void> => {
  const params = GetDirectoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [dir] = await db.select().from(directoriesTable).where(eq(directoriesTable.id, params.data.id));
  if (!dir) {
    res.status(404).json({ error: "Directory not found" });
    return;
  }

  const cats = await db.select().from(categoriesTable).where(eq(categoriesTable.directoryId, dir.id));

  res.json({
    id: dir.id,
    name: dir.name,
    year: dir.year,
    categoriesCount: cats.length,
    createdAt: dir.createdAt.toISOString(),
  });
});

router.delete("/directories/:id", async (req, res): Promise<void> => {
  const params = GetDirectoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [dir] = await db.select().from(directoriesTable).where(eq(directoriesTable.id, params.data.id));
  if (!dir) {
    res.status(404).json({ error: "Directory not found" });
    return;
  }

  await db.delete(categoriesTable).where(eq(categoriesTable.directoryId, params.data.id));
  await db.delete(directoriesTable).where(eq(directoriesTable.id, params.data.id));

  res.sendStatus(204);
});

router.get("/directories/:id/categories", async (req, res): Promise<void> => {
  const params = ListCategoriesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const cats = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.directoryId, params.data.id))
    .orderBy(categoriesTable.id);

  res.json(cats);
});

export default router;
