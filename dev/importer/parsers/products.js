import { readCsvObjects, toNumber, slugify } from "../utils.js";

// Expected columns: Name, Code, Slug, Category, Yield, Weight
// Output shape:     [{ slug, code, name, category, weight, yield }, ...]
//   slug     = Slug column (falls back to a slug of the name if blank), the product's unique identity
//   category = Slug of a row in the Categories tab (e.g. "paper-paper")
export default {
  tab: "Products",
  key: "products",

  parse(filePath) {
    const seen = new Set();
    const products = [];

    for (const row of readCsvObjects(filePath)) {
      if (!row.name) continue;

      const slug = row.slug || slugify(row.name);
      if (seen.has(slug)) {
        console.warn(`  [products] duplicate slug "${slug}" skipped`);
        continue;
      }
      seen.add(slug);

      products.push({
        slug,
        code: row.code || "",
        name: row.name,
        category: row.category,
        weight: toNumber(row.weight),
        yield: toNumber(row.yield),
      });
    }
    return products;
  },
};
