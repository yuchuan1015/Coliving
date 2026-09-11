// Offline shape validation of synthetic, actually serialized backend responses.
// No server, browser, tokens, or API calls. Existing unit tests verify request identity.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url), ts = require("typescript"), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const localRequire = name => {
    if (name === "./client") return { __esModule: true, default: new Proxy({}, { get() { return () => { throw Error("Network forbidden in contract check"); }; } }) };
    const path = resolve(dirname(file), name), next = [path, path + ".ts"].find(existsSync);
    if (!next) throw Error(`Unexpected import ${name}`);
    return load(next);
  };
  new Function("require", "module", "exports", source)(localRequire, module, module.exports);
  return module.exports;
}
const pets = load(resolve(root, "src/api/pets.ts")), wishes = load(resolve(root, "src/api/pet-wishes.ts"));
const counts = { results: 0, details: 0, wishLists: 0, pets: 0, petStatuses: 0, catalogs: 0 };
function inspect(value, path = "root") {
  if (!value || typeof value !== "object") return;
  try {
    if (value.wish && typeof value.wish === "object" && value.capacity) {
      if (value.receipt) {
        const w = value.wish, r = value.receipt;
        const pending = r.operation === "create" ? { kind: "create", body: { client_request_id: r.client_request_id, requested_name: w.requested_name, requested_species: w.requested_species, appearance_description: w.appearance_description } } :
          { kind: "arrive", wish_id: w.id, body: { client_request_id: r.client_request_id, expected_version: Math.max(1, w.version - 1) } };
        wishes.parseWishResult(value, pending, w.user_id); counts.results++;
      } else { wishes.parseWishDetail(value); counts.details++; }
    } else if (Array.isArray(value.pets) && Object.hasOwn(value, "max_pets")) { pets.parsePets(value); counts.pets++; }
    else if (Object.hasOwn(value, "hunger") && Object.hasOwn(value, "is_alive")) { pets.parsePet(value); counts.petStatuses++; }
    else if (Array.isArray(value.items) && Object.hasOwn(value, "has_more")) { wishes.parseWishList(value); counts.wishLists++; }
    else if (Array.isArray(value.items) && Object.hasOwn(value, "catalog_version")) { wishes.parsePetAssets(value); counts.catalogs++; }
  } catch (error) { throw Error(`${path}: ${error.message}`); }
  for (const [key, nested] of Object.entries(value)) inspect(nested, `${path}.${key}`);
}
if (!process.argv[2]) throw Error("Pass the synthetic backend JSON fixture path.");
const data = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
let successfulCases = 0, errorCases = 0;
if (!Array.isArray(data.cases)) throw Error("Expected the backend case export.");
for (const item of data.cases) {
  if (item.response.status >= 400) {
    const failure = wishes.wishError({ response: { status: item.response.status, data: item.response.body } });
    if (failure.status !== item.response.status || (item.response.body.detail?.code && failure.code !== item.response.body.detail.code)) throw Error(`${item.name}: invalid error parser`);
    errorCases++; continue;
  }
  const before = Object.values(counts).reduce((a, b) => a + b, 0);
  inspect(item.response.body, item.name);
  if (Object.values(counts).reduce((a, b) => a + b, 0) === before) throw Error(`${item.name}: no parser matched`);
  successfulCases++;
}
if (!counts.results || !counts.wishLists || !counts.catalogs || !counts.pets) throw Error(`Incomplete fixture: ${JSON.stringify(counts)}`);
console.log(JSON.stringify({ passed: true, successfulCases, errorCases, ...counts }));
