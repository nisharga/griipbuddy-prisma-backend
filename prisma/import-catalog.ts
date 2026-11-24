/**
 * Catalog import: creates locations, brands, return policies, suppliers,
 * categories and products (with variants, images and opening stock) from one
 * JSON file.
 *
 *   npm run db:import                         → prisma/seed-data/catalog.json
 *   npm run db:import -- path/to/other.json   → another file
 *
 * Safe to run again: anything that already exists (same name / title /
 * contact_id, or same SKU for products) is skipped, never duplicated.
 * Images are paths relative to the JSON file (e.g. "images/wallet.jpg") and are
 * uploaded with the API's storage (Cloudinary when configured).
 * Opening stock is recorded as one received purchase per location + supplier,
 * so the stock report gets real purchase prices.
 */
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { prisma } from "@/shared/prisma";
import { saveFile } from "@/helpers/fileStorage";
import { BusinessLocationService } from "@/modules/businessLocation/businessLocation.service";
import { BrandService } from "@/modules/brand/brand.service";
import { ReturnPolicyService } from "@/modules/returnPolicy/returnPolicy.service";
import { SupplierService } from "@/modules/supplier/supplier.service";
import { CategoryService } from "@/modules/category/category.service";
import { SubCategoryService } from "@/modules/subCategory/subCategory.service";
import { ProductService } from "@/modules/product/product.service";
import { PurchaseService } from "@/modules/purchase/purchase.service";
import { PurchaseValidation } from "@/modules/purchase/purchase.validation";

// ------------------------------------------------------------------ file format

const name = z.string().trim().min(1);
const image = z.string().trim().min(1); // path relative to the JSON file

const schema = z.object({
  businessLocations: z
    .array(
      z.object({
        name,
        type: z.enum(["OUTLET", "WAREHOUSE"]),
        address: name,
        manager_name: z.string().optional(),
        contact_numbers: z.array(z.string()).default([]),
      })
    )
    .default([]),
  brands: z.array(z.object({ name, tags: z.array(z.string()).default([]) })).default([]),
  returnPolicies: z
    .array(
      z.object({
        title: name,
        description: name,
        return_period_days: z.number().int().min(0),
        conditions: z.array(z.string()).default([]),
      })
    )
    .default([]),
  suppliers: z
    .array(
      z.object({
        contact_id: name,
        name,
        type: z.enum(["COMPANY", "INDIVIDUAL"]).default("COMPANY"),
        phone: name,
        email: z.string().email().optional(),
        address: name,
        default_payment_terms: z
          .enum(["CASH ON DELIVERY", "NET_7", "NET_15", "NET_30", "NET_60"])
          .default("CASH ON DELIVERY"),
        notes: z.string().optional(),
      })
    )
    .default([]),
  categories: z
    .array(
      z.object({
        name_en: name,
        name_bn: z.string().optional(),
        image: image.optional(),
        subcategories: z
          .array(
            z.object({
              name_en: name,
              name_bn: z.string().optional(),
              image: image.optional(),
              children: z.array(z.object({ name_en: name, name_bn: z.string().optional() })).default([]),
            })
          )
          .default([]),
      })
    )
    .default([]),
  products: z
    .array(
      z.object({
        sku: name,
        name: z.string().trim().min(3),
        description: z.string().default(""),
        category: name, // category name_en
        subcategory: z.string().optional(), // sub-category name_en
        sub_subcategory: z.string().optional(),
        brand: z.string().optional(), // brand name
        return_policy: z.string().optional(), // return policy title
        supplier: z.string().optional(), // supplier contact_id, for the opening-stock purchase
        thumbnail: image.optional(),
        slider_images: z.array(image).default([]),
        warranty: z.string().optional(),
        search_tags: z.array(z.string()).default([]),
        is_published: z.boolean().default(true),
        attributes: z.array(z.string()).default([]),
        variants: z
          .array(
            z.object({
              attribute_values: z.record(z.string()).default({}),
              regular_price: z.number().min(0),
              sale_price: z.number().min(0),
              cost: z.number().min(0).default(0), // purchase price per unit
              image: image.optional(),
              stock: z.record(z.number().int().min(0)).default({}), // { "<location name>": qty }
            })
          )
          .min(1),
      })
    )
    .default([]),
});

// ------------------------------------------------------------------ helpers

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
};

const stats = { created: 0, skipped: 0, images: 0, missingImages: 0 };
const log = (verb: "created" | "skipped", what: string) => {
  stats[verb]++;
  console.log(`  ${verb === "created" ? "+" : "·"} ${verb} ${what}`);
};

const makeUploader = (baseDir: string) => {
  const cache = new Map<string, string | undefined>();
  return async (rel?: string) => {
    if (!rel) return undefined;
    if (/^https?:\/\//.test(rel)) return rel; // already a URL
    if (cache.has(rel)) return cache.get(rel);
    const abs = path.resolve(baseDir, rel);
    const buffer = await fs.readFile(abs).catch(() => null);
    if (!buffer) {
      stats.missingImages++;
      console.warn(`  ! image not found, skipped: ${rel}`);
      cache.set(rel, undefined);
      return undefined;
    }
    const ext = path.extname(abs).toLowerCase();
    const url = await saveFile({
      originalname: path.basename(abs),
      mimetype: MIME[ext] ?? "application/octet-stream",
      size: buffer.length,
      buffer,
    } as Express.Multer.File);
    stats.images++;
    cache.set(rel, url);
    return url;
  };
};

// ------------------------------------------------------------------ import

async function main() {
  const file = path.resolve(process.argv[2] ?? path.join(__dirname, "seed-data", "catalog.json"));
  const parsed = schema.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
  if (!parsed.success) {
    console.error(`❌ ${path.relative(process.cwd(), file)} is not valid:`);
    for (const i of parsed.error.issues) console.error(`   • ${i.path.join(".")}: ${i.message}`);
    process.exitCode = 1;
    return;
  }
  const data = parsed.data;
  const upload = makeUploader(path.dirname(file));
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN", is_deleted: false } });
  if (!admin) throw new Error("No super admin found. Run `npm run db:seed` first.");
  console.log(`📦 Importing ${path.relative(process.cwd(), file)}`);

  console.log("\nBusiness locations");
  const locations = new Map<string, string>();
  for (const l of data.businessLocations) {
    const found = await prisma.businessLocation.findFirst({
      where: { name: { equals: l.name, mode: "insensitive" } },
    });
    if (found) log("skipped", l.name);
    else
      log(
        "created",
        (
          await BusinessLocationService.create({
            name: l.name,
            type: l.type,
            address: { local_address: l.address },
            manager_name: l.manager_name,
            contact_numbers: l.contact_numbers,
          })
        ).name
      );
  }
  for (const l of await prisma.businessLocation.findMany()) locations.set(l.name.toLowerCase(), l.id);

  console.log("\nBrands");
  for (const b of data.brands) {
    if (await prisma.brand.findFirst({ where: { name: { equals: b.name, mode: "insensitive" } } }))
      log("skipped", b.name);
    else log("created", (await BrandService.create({ name: b.name, tags: b.tags, is_active: true })).name);
  }

  console.log("\nReturn policies");
  for (const r of data.returnPolicies) {
    if (await prisma.returnPolicy.findFirst({ where: { title: { equals: r.title, mode: "insensitive" } } }))
      log("skipped", r.title);
    else log("created", (await ReturnPolicyService.create({ ...r, is_active: true })).title);
  }

  console.log("\nSuppliers");
  for (const s of data.suppliers) {
    if (await prisma.supplier.findUnique({ where: { contact_id: s.contact_id } }))
      log("skipped", `${s.contact_id} ${s.name}`);
    else log("created", `${s.contact_id} ${(await SupplierService.create(s)).name}`);
  }

  console.log("\nCategories");
  for (const c of data.categories) {
    let cat = await prisma.category.findFirst({
      where: { name_en: { equals: c.name_en, mode: "insensitive" } },
    });
    if (cat) log("skipped", c.name_en);
    else {
      cat = await CategoryService.create({
        name_en: c.name_en,
        name_bn: c.name_bn,
        image_url: await upload(c.image),
      });
      log("created", c.name_en);
    }
    for (const s of c.subcategories) {
      let sub = await prisma.subCategory.findFirst({
        where: {
          category_id: cat.id,
          subcategory_id: null,
          name_en: { equals: s.name_en, mode: "insensitive" },
        },
      });
      if (sub) log("skipped", `${c.name_en} › ${s.name_en}`);
      else {
        sub = await SubCategoryService.create({
          category: cat.id,
          name_en: s.name_en,
          name_bn: s.name_bn,
          image_url: await upload(s.image),
        });
        log("created", `${c.name_en} › ${s.name_en}`);
      }
      for (const ch of s.children) {
        const exists = await prisma.subCategory.findFirst({
          where: { subcategory_id: sub.id, name_en: { equals: ch.name_en, mode: "insensitive" } },
        });
        if (exists) log("skipped", `${c.name_en} › ${s.name_en} › ${ch.name_en}`);
        else {
          await SubCategoryService.createChild({
            subcategory: sub.id,
            name_en: ch.name_en,
            name_bn: ch.name_bn,
          });
          log("created", `${c.name_en} › ${s.name_en} › ${ch.name_en}`);
        }
      }
    }
  }

  console.log("\nProducts");
  // Opening stock, grouped into one purchase per location + supplier.
  const purchases = new Map<
    string,
    {
      location: string;
      supplier: string;
      items: { product: string; variant: string; qty: number; unit_cost: number; discount: number }[];
    }
  >();
  const defaultSupplier = await prisma.supplier.findFirst({ orderBy: { createdAt: "asc" } });

  for (const p of data.products) {
    if (await prisma.product.findUnique({ where: { sku: p.sku } })) {
      log("skipped", `${p.sku} ${p.name}`);
      continue;
    }
    const cat = await prisma.category.findFirst({
      where: { name_en: { equals: p.category, mode: "insensitive" } },
    });
    if (!cat) throw new Error(`Product ${p.sku}: category "${p.category}" not found.`);
    const sub = p.subcategory
      ? await prisma.subCategory.findFirst({
          where: {
            category_id: cat.id,
            subcategory_id: null,
            name_en: { equals: p.subcategory, mode: "insensitive" },
          },
        })
      : null;
    if (p.subcategory && !sub)
      throw new Error(`Product ${p.sku}: sub-category "${p.subcategory}" not found.`);
    const subSub =
      sub && p.sub_subcategory
        ? await prisma.subCategory.findFirst({
            where: { subcategory_id: sub.id, name_en: { equals: p.sub_subcategory, mode: "insensitive" } },
          })
        : null;
    const brand = p.brand
      ? await prisma.brand.findFirst({ where: { name: { equals: p.brand, mode: "insensitive" } } })
      : null;
    if (p.brand && !brand) throw new Error(`Product ${p.sku}: brand "${p.brand}" not found.`);
    const policy = p.return_policy
      ? await prisma.returnPolicy.findFirst({
          where: { title: { equals: p.return_policy, mode: "insensitive" } },
        })
      : null;
    if (p.return_policy && !policy)
      throw new Error(`Product ${p.sku}: return policy "${p.return_policy}" not found.`);
    const supplier = p.supplier
      ? await prisma.supplier.findUnique({ where: { contact_id: p.supplier } })
      : defaultSupplier;
    if (p.supplier && !supplier) throw new Error(`Product ${p.sku}: supplier "${p.supplier}" not found.`);

    const variantImages = await Promise.all(p.variants.map((v) => upload(v.image)));
    const created = await ProductService.create({
      name: p.name,
      description: p.description,
      sku: p.sku,
      category: cat.id,
      subcategory: sub?.id ?? "",
      sub_subcategory: subSub?.id ?? "",
      brand: brand?.id ?? "",
      return_policy: policy?.id ?? "",
      thumbnail: await upload(p.thumbnail),
      slider_images: (await Promise.all(p.slider_images.map(upload))).filter(Boolean),
      warranty: p.warranty,
      search_tags: p.search_tags,
      is_published: p.is_published,
      attributes: p.attributes,
      variantsCombination: p.variants.map((v, i) => ({
        attribute_values: v.attribute_values,
        regular_price: v.regular_price,
        sale_price: v.sale_price,
        ...(variantImages[i] ? { image: variantImages[i] } : {}),
      })),
    });
    log(
      "created",
      `${p.sku} ${p.name} (${created.variants.length} variant${created.variants.length > 1 ? "s" : ""})`
    );

    // Match each created variant to its JSON row by attribute values.
    const key = (a: unknown) => JSON.stringify(Object.entries((a ?? {}) as object).sort());
    for (const v of p.variants) {
      const variant = created.variants.find((cv) => key(cv.attribute_values) === key(v.attribute_values));
      if (!variant) continue;
      for (const [locName, qty] of Object.entries(v.stock)) {
        if (!qty) continue;
        const locationId = locations.get(locName.toLowerCase());
        if (!locationId) throw new Error(`Product ${p.sku}: location "${locName}" not found.`);
        if (!supplier) throw new Error(`Product ${p.sku}: stock needs a supplier, but none exist.`);
        const k = `${locationId}|${supplier.id}`;
        const group = purchases.get(k) ?? { location: locationId, supplier: supplier.id, items: [] };
        group.items.push({ product: created.id, variant: variant.id, qty, unit_cost: v.cost, discount: 0 });
        purchases.set(k, group);
      }
    }
  }

  console.log("\nOpening stock (received purchases)");
  if (!purchases.size) console.log("  (nothing new to stock)");
  for (const g of purchases.values()) {
    const body = PurchaseValidation.createSchema.shape.body.parse({
      business_location: g.location,
      supplier: g.supplier,
      items: g.items,
      status: "received",
      purchase_date: new Date().toISOString(),
      additional_notes: "Opening stock (catalog import)",
    });
    const purchase = await PurchaseService.create(body, admin.id);
    const units = g.items.reduce((s, i) => s + i.qty, 0);
    log(
      "created",
      `purchase #${purchase.purchase_number}: ${units} units → ${purchase.business_location.name}`
    );
  }

  console.log(
    `\n✅ Done. ${stats.created} created, ${stats.skipped} already existed, ${stats.images} image(s) uploaded` +
      (stats.missingImages ? `, ${stats.missingImages} image(s) missing (see warnings above).` : ".")
  );
}

main()
  .catch((err) => {
    console.error(`\n❌ Import stopped: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  // Services may open Redis/queue connections; exit explicitly once done.
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
