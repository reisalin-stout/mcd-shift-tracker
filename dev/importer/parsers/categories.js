import { table, slug, number } from "../utils.js";

// Categories: slug + id. The id is the priority: items listed from several categories are grouped by category, in id order.
export default table("Categories", "categories", { slug: slug(), id: number({ required: true, unique: true }) });
