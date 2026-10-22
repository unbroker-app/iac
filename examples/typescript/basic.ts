import {
  defineUnbroker,
  image,
  preserve,
  project,
  repository,
  service,
  volume,
} from "@unbroker/iac";

export default defineUnbroker((ctx) => {
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
    start: "bun run start",
    port: 3000,
    replicas: ctx.isEnvironment("production") ? 3 : 1,
    env: { DATABASE_HOST: postgres.host },
  });
  return project("acme", { resources: [data, postgres, api] });
});
