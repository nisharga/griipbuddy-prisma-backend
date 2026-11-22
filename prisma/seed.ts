/* Idempotent seed — safe to run repeatedly; existing records are left alone. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import slugify from "slugify";
import { PERMISSIONS, STAFF_ROLES } from "../src/constants/permissions";

const prisma = new PrismaClient();
const ALL = [...PERMISSIONS] as string[];
const crud = (m: string) => [`${m}.create`, `${m}.update`, `${m}.delete`, `${m}.view`];
const slug = (s: string) => slugify(s, { lower: true, strict: true });

/** Starting permissions per built-in role (editable later in the admin). */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  FOUNDER: ALL,
  SUPER_ADMIN: ALL,
  ADMIN: ALL.filter((p) => p !== "manage-permissions"),
  MODERATOR: [...crud("product"), ...crud("cms"), ...crud("faq"), ...crud("review"), "order.view"],
  SALES_EXECUTIVE: [...crud("order"), ...crud("pos"), "product.view", "coupon.view"],
  SUPPORT_ADMIN: [
    "order.view",
    "order.update",
    "order.return",
    "product.view",
    "user.view",
    ...crud("review"),
  ],
  CUSTOMER_SUPPORT: ["order.view", "order.update", "product.view", "user.view"],
  CUSTOMER_EXECUTIVE: ["order.view", "order.create", "product.view", "user.view"],
  OUTLET_MANAGER: [...crud("pos"), "stock.view", "stock.transfer", "product.view", "order.view"],
  WAREHOUSE_MANAGER: [...crud("stock"), "stock.transfer", ...crud("purchase"), "product.view"],
  INVENTORY_MANAGER: [...crud("stock"), "stock.transfer", ...crud("product"), "purchase.view"],
  ACCOUNT_MANAGER: [
    "report.view",
    "purchase.view",
    "purchase.value.view",
    "potential.profit.view",
    "order.view",
    "pos.view",
  ],
};

async function seedRolesAndAdmin() {
  for (const role_name of STAFF_ROLES) {
    await prisma.role.upsert({
      where: { role_name },
      update: {},
      create: { role_name, permissions: ROLE_PERMISSIONS[role_name] ?? [] },
    });
  }
  const phone = process.env.SEED_ADMIN_PHONE || "01700000000";
  const role = await prisma.role.findUniqueOrThrow({ where: { role_name: "SUPER_ADMIN" } });
  const exists = await prisma.user.findUnique({ where: { phone_number: phone } });
  if (!exists) {
    await prisma.user.create({
      data: {
        full_name: process.env.SEED_ADMIN_NAME || "Super Admin",
        phone_number: phone,
        email: process.env.SEED_ADMIN_EMAIL || "admin@example.com",
        password: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "Admin@12345", 12),
        role: "SUPER_ADMIN",
        role_ref_id: role.id,
        permissions: ALL,
        gender: "MALE",
      },
    });
    console.log(`  • super admin ${phone}`);
  }
}

async function seedCatalog() {
  if (await prisma.product.count()) return console.log("  • catalog has products — skipping sample catalog");

  await prisma.$transaction(async (tx) => {
    const outlet = await tx.businessLocation.create({
      data: {
        name: "Main Outlet",
        slug: "main-outlet",
        type: "OUTLET",
        address: {
          division: "Dhaka",
          district: "Dhaka",
          thana: "Gulshan",
          local_address: "House 1, Road 1, Gulshan 1",
        },
        manager_name: "Outlet Manager",
        contact_numbers: ["01700000001"],
      },
    });
    const warehouse = await tx.businessLocation.create({
      data: {
        name: "Central Warehouse",
        slug: "central-warehouse",
        type: "WAREHOUSE",
        address: {
          division: "Dhaka",
          district: "Gazipur",
          thana: "Tongi",
          local_address: "Plot 10, Tongi Industrial Area",
        },
        manager_name: "Warehouse Manager",
        contact_numbers: ["01700000002"],
      },
    });
    const policy = await tx.returnPolicy.create({
      data: {
        title: "7 Days Easy Return",
        slug: "7-days-easy-return",
        description: "Return unused items in original packaging within 7 days of delivery.",
        return_period_days: 7,
        conditions: ["Product must be unused", "Original packaging and tags required", "Invoice required"],
      },
    });
    const leather = await tx.brand.create({
      data: { name: "Leather Craft", slug: "leather-craft", tags: ["leather", "premium"] },
    });
    const urban = await tx.brand.create({
      data: { name: "Urban Step", slug: "urban-step", tags: ["shoes", "casual"] },
    });

    const tree: Record<string, string[]> = {
      Bags: ["Backpacks", "Wallets"],
      Footwear: ["Sneakers", "Formal Shoes"],
    };
    const subs: Record<string, string> = {};
    const cats: Record<string, string> = {};
    let position = 1;
    for (const [name, children] of Object.entries(tree)) {
      const c = await tx.category.create({
        data: { name_en: name, name_bn: name, slug: slug(name), position: position++ },
      });
      cats[name] = c.id;
      for (const child of children) {
        const s = await tx.subCategory.create({
          data: { name_en: child, name_bn: child, slug: slug(child), category_id: c.id },
        });
        subs[child] = s.id;
      }
    }

    const wallet = await tx.product.create({
      data: {
        name: "Classic Leather Wallet",
        slug: "classic-leather-wallet",
        sku: "WLT-001",
        description: "<p>Hand-stitched genuine leather wallet with 6 card slots.</p>",
        category_id: cats.Bags,
        subcategory_id: subs.Wallets,
        brand_id: leather.id,
        return_policy_id: policy.id,
        shipping_cost: 60,
        approximately_delivery_time: "2 to 3 days",
        min_price: 1250,
        variants: {
          create: [{ sku: "WLT-001", barcode: "200000000001", regular_price: 1500, sale_price: 1250 }],
        },
      },
    });
    const sneaker = await tx.product.create({
      data: {
        name: "Urban Runner Sneaker",
        slug: "urban-runner-sneaker",
        sku: "SNK-001",
        description: "<p>Lightweight everyday sneaker.</p>",
        category_id: cats.Footwear,
        subcategory_id: subs.Sneakers,
        brand_id: urban.id,
        return_policy_id: policy.id,
        shipping_cost: 80,
        approximately_delivery_time: "3 to 4 days",
        attributes: ["Size", "Color"],
        min_price: 3800,
        variants: {
          create: [
            {
              sku: "SNK-001-1",
              barcode: "200000000002",
              attributes: ["Size", "Color"],
              attribute_values: { Size: "41", Color: "Black" },
              regular_price: 4200,
              sale_price: 3800,
              color_code: "#000000",
              serial: 1,
            },
            {
              sku: "SNK-001-2",
              barcode: "200000000003",
              attributes: ["Size", "Color"],
              attribute_values: { Size: "42", Color: "Black" },
              regular_price: 4200,
              sale_price: 3800,
              color_code: "#000000",
              serial: 2,
            },
            {
              sku: "SNK-001-3",
              barcode: "200000000004",
              attributes: ["Size", "Color"],
              attribute_values: { Size: "42", Color: "White" },
              regular_price: 4200,
              sale_price: 3900,
              color_code: "#FFFFFF",
              serial: 3,
            },
          ],
        },
      },
    });

    // Every variant gets a stock row at every location; 25 units to start at the warehouse.
    const variants = await tx.productVariant.findMany({
      where: { product_id: { in: [wallet.id, sneaker.id] } },
    });
    await tx.stock.createMany({
      data: variants.flatMap((v) => [
        {
          product_id: v.product_id,
          variant_id: v.id,
          business_location_id: warehouse.id,
          available_quantity: 25,
        },
        {
          product_id: v.product_id,
          variant_id: v.id,
          business_location_id: outlet.id,
          available_quantity: 0,
        },
      ]),
    });
  });
  console.log("  • sample locations, policy, brands, categories, 2 products, starting stock");
}

const SAMPLE_SUPPLIERS = [
  {
    contact_id: "SUP-0001",
    name: "Dhaka Leather Works Ltd.",
    type: "COMPANY",
    phone: "01711000001",
    email: "sales@dhakaleather.example",
    address: "Plot 12, Hazaribagh Tannery Area, Dhaka 1209",
    default_payment_terms: "NET_30",
    tax_info: "BIN 000123456-0101",
    notes: "Leather wallets, belts and bags.",
  },
  {
    contact_id: "SUP-0002",
    name: "Bengal Footwear Industries",
    type: "COMPANY",
    phone: "01711000002",
    email: "orders@bengalfootwear.example",
    address: "BSCIC Industrial Estate, Tongi, Gazipur",
    default_payment_terms: "NET_15",
    tax_info: "BIN 000234567-0102",
    notes: "Shoes and sandals; minimum order 50 pairs.",
  },
  {
    contact_id: "SUP-0003",
    name: "Chittagong Textile House",
    type: "COMPANY",
    phone: "01811000003",
    email: "info@ctgtextile.example",
    address: "Agrabad C/A, Chattogram 4100",
    default_payment_terms: "NET_7",
    tax_info: null,
    notes: "Fabric bags and packaging.",
  },
  {
    contact_id: "SUP-0004",
    name: "Rahim Uddin",
    type: "INDIVIDUAL",
    phone: "01911000004",
    email: null,
    address: "House 7, Road 3, Mirpur 10, Dhaka 1216",
    default_payment_terms: "CASH ON DELIVERY",
    tax_info: null,
    notes: "Local handmade accessories.",
  },
  {
    contact_id: "SUP-0005",
    name: "Sylhet Craft Suppliers",
    type: "COMPANY",
    phone: "01611000005",
    email: "hello@sylhetcraft.example",
    address: "Zindabazar, Sylhet 3100",
    default_payment_terms: "NET_60",
    tax_info: "BIN 000345678-0103",
    notes: null,
  },
];

async function seedSuppliers() {
  for (const s of SAMPLE_SUPPLIERS) {
    await prisma.supplier.upsert({ where: { contact_id: s.contact_id }, update: {}, create: s });
  }
  console.log(`  • ${SAMPLE_SUPPLIERS.length} sample suppliers`);
}

async function main() {
  console.log("🌱 Seeding…");
  await seedRolesAndAdmin();
  await seedCatalog();
  await seedSuppliers();
  console.log("✅ Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
