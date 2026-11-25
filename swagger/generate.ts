/**
 * Writes swagger/openapi.json from the routes. Run after changing routes or schemas:
 *   npm run docs
 * The server shows it at /docs (and the raw file at /docs.json).
 */
import fs from "fs";
import path from "path";
import { buildOpenApi, unknownEndpointKeys } from "./build";

const doc = buildOpenApi();

const unknown = unknownEndpointKeys(doc);
if (unknown.length) {
  console.error(`swagger/endpoints.ts has entries for routes that don't exist:\n  ${unknown.join("\n  ")}`);
  process.exit(1);
}

const file = path.join(__dirname, "openapi.json");
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

const count = Object.values(doc.paths).reduce((sum, methods) => sum + Object.keys(methods).length, 0);
console.log(`✔ ${count} endpoints → swagger/openapi.json`);
process.exit(0); // don't wait for Redis / Prisma connections opened by the imports
