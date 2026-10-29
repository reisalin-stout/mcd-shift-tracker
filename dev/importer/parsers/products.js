import { table, slug, text, number } from "../utils.js";

// Products: id/extension are the box code (text, so leading zeros stay), yield = units per box (0 = unknown),
// unit = step of one +/- tap in the app (default 1; -1 = "fill" product with a Fill button instead; 0 counts as 1).
export default table("Products", "products", {
  slug: slug(),
  category: text({ ref: "categories" }),
  id: text(),
  extension: text(),
  yield: number(),
  unit: number({ fallback: 1, check: (n) => n === 0 && "a Unit of 0 is counted as 1 by the app" }),
});
