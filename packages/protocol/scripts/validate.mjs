import { readFile, readdir } from "node:fs/promises";

const schemaDirectory = new URL("../schemas/v1/", import.meta.url);
const schemaFiles = (await readdir(schemaDirectory)).filter((file) =>
  file.endsWith(".json"),
);

for (const file of schemaFiles) {
  JSON.parse(await readFile(new URL(file, schemaDirectory), "utf8"));
}

const manifest = JSON.parse(
  await readFile(new URL("manifest.json", schemaDirectory), "utf8"),
);

if (manifest.protocol !== "voxera" || manifest.version !== "1.0") {
  throw new Error("Unexpected Voxera protocol identity");
}

const canonicalEvents = Object.values(manifest.canonicalEvents);
if (new Set(canonicalEvents).size !== canonicalEvents.length) {
  throw new Error("Canonical event names must be unique");
}

for (const [canonical, aliases] of Object.entries(manifest.legacyAliases)) {
  if (!canonicalEvents.includes(canonical)) {
    throw new Error(`Legacy aliases reference unknown event: ${canonical}`);
  }

  if (aliases.includes(canonical)) {
    throw new Error(`Legacy aliases repeat canonical event: ${canonical}`);
  }
}

/*
 * The schemas restate the TypeScript types by hand, so they drift: 0.3.0
 * shipped a schema that refused `language` and `metadata` (it forbids
 * unknown properties), demanded a UUID agentId the type never required, and
 * listed three fewer error codes than the SDKs send. Parsing the JSON above
 * never noticed. These compare the two directly.
 */
const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const schema = (file) =>
  readFile(new URL(file, schemaDirectory), "utf8").then(JSON.parse);

const unionMembers = (name) => {
  const match = source.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  if (!match) throw new Error(`type ${name} not found in src/index.ts`);
  return [...match[1].matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1]);
};
const interfaceKeys = (name) => {
  const match = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`interface ${name} not found in src/index.ts`);
  // Top-level members only: two-space indent, then a name.
  return [...match[1].matchAll(/^  (\w+)\??:/gm)].map((m) => m[1]);
};
const sameSet = (label, expected, actual) => {
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} out of step with src/index.ts` +
        (missing.length ? `; missing: ${missing.join(", ")}` : "") +
        (extra.length ? `; not in the type: ${extra.join(", ")}` : ""),
    );
  }
};

const init = await schema("init-session-connection.schema.json");
sameSet(
  "init-session-connection properties",
  interfaceKeys("InitSessionConnection"),
  Object.keys(init.properties),
);
sameSet("init-session-connection clientType", unionMembers("ClientType"), init.properties.clientType.enum);
// A format is a constraint the TypeScript type cannot express or enforce, so
// the schema must not add one the SDKs would never check before sending.
for (const [key, property] of Object.entries(init.properties)) {
  if (property.format) throw new Error(`init-session-connection.${key} adds format "${property.format}"`);
}

const result = await schema("command-result.schema.json");
sameSet(
  "command-result error codes",
  unionMembers("VoxeraErrorCode"),
  result.oneOf[1].properties.error.properties.code.enum,
);

console.log(`Validated ${schemaFiles.length} Voxera protocol files against src/index.ts.`);
