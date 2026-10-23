import { readCsvObjects, toNumber, slugify } from "../utils.js";


// Output shape:     [{ slug, code, name, category, yield, increment }, ...]
//   slug      = Slug column (falls back to a slug of the name if blank), the product's unique identity
//   category  = Slug of a row in the Categories tab (e.g. "paper-cups")
//   yield     = units per box/package (0 = unknown)
//   name      = Name column; falls back to the slug when the Name is empty
//   increment = how much one tap of + / - changes the restock count (default 1).
//               Negative (-1) = "fill" product: no count, the app shows a Fill button instead of + / -.
//               0 is invalid (the app counts it by 1, the importer warns).
export default {
  tab: "Products",
  key: "products",

  parse(filePath) {
    const seen = new Set();
    const products = [];
    const noName = [];
    const zeroIncrement = [];

    for (const row of readCsvObjects(filePath)) {
      const slug = row.slug || (row.name ? slugify(row.name) : "");
      if (!slug) {
        console.warn(`  [products] row with no Name and no Slug skipped${row.code ? ` (code ${row.code})` : ""}`);
        continue;
      }
      if (seen.has(slug)) {
        console.warn(`  [products] duplicate slug "${slug}" skipped`);
        continue;
      }
      seen.add(slug);
      if (!row.name) noName.push(slug);

      const increment = toNumber(row.increment, 1);
      if (increment === 0) zeroIncrement.push(slug);

      products.push({
        slug,
        code: row.code || "",
        name: row.name || slug,
        category: row.category,
        yield: toNumber(row.yield),
        increment,
      });
    }
    if (noName.length) console.warn(`  [products] ${noName.length} product(s) have no Name, the slug is used as the name: ${noName.join(", ")}`);
    if (zeroIncrement.length) console.warn(`  [products] ${zeroIncrement.length} product(s) have an Increment of 0 (the app counts them by 1): ${zeroIncrement.join(", ")}`);
    return products;
  },
};
