import slugify from "slugify";

/**
 * A slug for `text` that `exists(slug)` reports as free. Appends -2, -3, … on clashes.
 * Pass the model's own lookup, e.g. `(s) => prisma.brand.count({ where: { slug: s, NOT: { id } } })`.
 */
export const uniqueSlug = async (
  text: string,
  exists: (slug: string) => Promise<number>
): Promise<string> => {
  const base = slugify(text || "item", { lower: true, strict: true }) || "item";
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await exists(slug))) return slug;
  }
};
