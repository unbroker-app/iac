import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "prettier";
import { zodToJsonSchema } from "zod-to-json-schema";
import { desiredStateSchema } from "../src/schema.ts";

const destination = resolve("schema/desired-state.schema.json");
const generated = await format(
  JSON.stringify(
    zodToJsonSchema(desiredStateSchema, {
      name: "UnbrokerDesiredState",
      target: "jsonSchema7",
    }),
  ),
  { parser: "json" },
);

if (process.argv.includes("--check")) {
  const current = readFileSync(destination, "utf8");
  if (current !== generated) {
    console.error(
      "schema/desired-state.schema.json is stale; run bun run build:schema",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(destination, generated);
  console.log(`wrote ${destination}`);
}
