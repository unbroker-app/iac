import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  defineUnbroker,
  image,
  preserve,
  project,
  repository,
  service,
  volume,
} from "./index.ts";

test("TypeScript SDK matches the shared basic-project fixture", () => {
  const config = defineUnbroker(() => {
    const data = volume("postgres-data", { sizeGb: 20 });
    const postgres = service("postgres", {
      source: image("postgres:17"),
      port: 5432,
      volume: data.mount("/var/lib/postgresql/data"),
      env: { POSTGRES_PASSWORD: preserve() },
    });
    const api = service("api", {
      source: repository("https://github.com/acme/platform", {
        branch: "main",
        framework: "node",
        rootDir: "apps/api",
      }),
      build: "bun run build",
      start: "bun run start",
      port: 3000,
      healthcheck: "/health",
      replicas: 2,
      env: { DATABASE_HOST: postgres.host },
      domains: ["api.example.com"],
    });
    return project("acme", { resources: [data, postgres, api] });
  });
  const actual = config.evaluate({
    command: "plan",
    projectId: "prj_test",
    projectName: "acme",
    environmentId: "env_test",
    environment: "production",
    environmentName: "production",
    isEnvironment: (name) => name === "production",
  });
  const expected = JSON.parse(
    readFileSync(
      new URL("../conformance/fixtures/basic-project.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(actual, expected);
});
