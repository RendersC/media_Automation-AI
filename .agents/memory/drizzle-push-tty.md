---
name: Drizzle push column conflicts need TTY
description: How to apply Drizzle schema column rename/type changes when push fails in non-interactive shell
---

# Drizzle `push` fails on column conflicts in agent shell

`pnpm --filter @workspace/db run push` errors with "Interactive prompts require a TTY terminal" whenever drizzle-kit needs a rename-vs-drop decision (e.g. renaming a column or changing its type, like `category_id int` → `category_ids int[]`).

**Why:** the agent shell has no TTY, so drizzle-kit's interactive conflict resolver cannot run.

**How to apply:** apply the column change directly with SQL first (via the `executeSql` code-execution callback — dev DB, test data, data loss acceptable), e.g.
`ALTER TABLE x DROP COLUMN IF EXISTS old; ALTER TABLE x ADD COLUMN IF NOT EXISTS new <type> NOT NULL DEFAULT '{}';`
then re-run `push` — it reports "No changes detected" and stays in sync. Pure additive schema changes push fine without this workaround.
