import { readCsvObjects, toNumber } from "../utils.js";

// Expected columns: Name, ID, Slug, Macro, Adjustment
// Output shape:     [{ id, slug, name, macro, adjustment }, ...]
export default {
  tab: "Categories",   // sheet/tab name this parser handles
  key: "categories",   // key in the final database.json

  parse(filePath) {
    const seenIds = new Set();
    const seenSlugs = new Set();
    const categories = [];

    for (const row of readCsvObjects(filePath)) {
      if (!row.name) continue;

      const id = toNumber(row.id, null);
      if (id === null) {
        console.warn(`  [categories] "${row.name}" has no valid ID, skipped`);
        continue;
      }
      if (seenIds.has(id)) {
        console.warn(`  [categories] duplicate ID ${id} ("${row.name}") skipped`);
        continue;
      }
      if (!row.slug) {
        console.warn(`  [categories] "${row.name}" has no Slug, skipped (products refer to categories by slug)`);
        continue;
      }
      if (seenSlugs.has(row.slug)) {
        console.warn(`  [categories] duplicate slug "${row.slug}" ("${row.name}") skipped`);
        continue;
      }
      seenIds.add(id);
      seenSlugs.add(row.slug);

      categories.push({
        id,
        slug: row.slug,
        name: row.name,
        macro: row.macro,
        adjustment: toNumber(row.adjustment, 100),
      });
    }
    return categories;
  },
};
