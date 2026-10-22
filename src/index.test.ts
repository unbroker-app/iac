import assert from "node:assert/strict";
import test from "node:test";
import {
  defineUnbroker,
  desiredStateSchema,
  fromEnv,
  image,
  preserve,
  project,
  repository,
  service,
  volume,
} from "./index.ts";

const context = {
  command: "plan" as const,
  projectId: "prj_1",
  projectName: "Acme",
  environmentId: "env_1",
  environment: "production",
  environmentName: "production",
  isEnvironment: (name: string) => name === "production",
};

test("compiles resources and references to canonical desired state", () => {
  const config = defineUnbroker((ctx) => {
    const data = volume("data", { sizeGb: 10 });
    const db = service("db", {
      source: image("postgres:17"),
      port: 5432,
      volume: data.mount("/var/lib/postgresql/data"),
      env: { POSTGRES_PASSWORD: preserve() },
    });
    const api = service("api", {
      source: repository("https://github.com/acme/app", {
        branch: "main",
        framework: "node",
      }),
      replicas: ctx.isEnvironment("production") ? 2 : 1,
      env: { DATABASE_HOST: db.host },
    });
    return project("Acme", { resources: [data, db, api] });
  });

  const desired = config.evaluate(context);
  assert.doesNotThrow(() => desiredStateSchema.parse(desired));
  assert.equal(desired.project.services[1]?.replicas, 2);
  assert.equal(
    desired.project.services[1]?.env.DATABASE_HOST,
    "${{services.db.host}}",
  );
  assert.deepEqual(desired.project.services[0]?.env.POSTGRES_PASSWORD, {
    $unbroker: "preserve",
  });
});

test("fromEnv fails closed when a required value is absent", () => {
  assert.equal(fromEnv("TOKEN", { TOKEN: "secret" }), "secret");
  assert.throws(() => fromEnv("TOKEN", {}), /Missing required/);
});

test("service env references reject invalid keys and are not thenables", () => {
  const api = service("api", {
    source: repository("https://github.com/acme/api", { framework: "node" }),
  });
  assert.equal(api.env.DATABASE_URL, "${{services.api.env.DATABASE_URL}}");
  assert.equal(Reflect.get(api.env, "then"), undefined);
  assert.equal(Reflect.get(api.env, Symbol.toStringTag), undefined);
  assert.throws(() => Reflect.get(api.env, "lowercase"), /Invalid environment/);
});

test("a mount must reference the exact declared volume resource", () => {
  const declared = volume("data", { sizeGb: 10 });
  const foreign = volume("data", { sizeGb: 20 });
  const api = service("api", {
    source: repository("https://github.com/acme/api", { framework: "node" }),
    volume: foreign.mount("/data"),
  });
  const config = defineUnbroker(() =>
    project("Acme", { resources: [declared, api] }),
  );
  assert.throws(() => config.evaluate(context), /undeclared volume/);
});
