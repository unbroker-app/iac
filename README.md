# Unbroker Infrastructure as Code

Open-source authoring SDKs and the language-neutral desired-state contract for
Unbroker Cloud Infrastructure as Code.

Every language SDK in this repository produces the same versioned JSON graph.
`ubctl` evaluates the local authoring file and sends that graph to Unbroker's
server-side `plan` and `apply` APIs. SDKs never hold credentials or mutate cloud
resources directly.

## Repository layout

```text
src/                         TypeScript SDK (`@unbroker/iac`)
schema/                      Generated language-neutral JSON Schema
conformance/fixtures/        Expected output shared by every language
examples/typescript/         TypeScript examples
go/                          Future Go SDK
python/                      Future Python SDK
```

Go, Python and future implementations belong in this same repository and must
pass the shared conformance fixtures before release.

## TypeScript

```bash
bun add --dev github:unbroker-app/iac#v0.1.0
```

The npm publication of `@unbroker/iac` will replace the GitHub install command
once npm trusted publishing is configured for the organization.

Create `.unbroker/unbroker.ts`:

```ts
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
    replicas: ctx.isEnvironment("production") ? 3 : 1,
    env: { DATABASE_HOST: postgres.host },
  });
  return project("acme", { resources: [data, postgres, api] });
});
```

Then use the CLI:

```bash
ubctl config plan <projectId>
ubctl config apply <projectId> --plan <planId> --yes
```

## Contract and conformance

[`schema/desired-state.schema.json`](./schema/desired-state.schema.json) is the
portable contract consumed by non-TypeScript implementations. It is generated
from the TypeScript validation schema and checked in CI.

Each SDK must render the documents under
[`conformance/fixtures`](./conformance/fixtures) byte-for-byte after canonical
JSON formatting. Language-specific ergonomics are encouraged; wire semantics
must remain identical.

## Development

```bash
bun install
bun run check-types
bun run test
bun run check:schema
bun run format:check
```

After changing the contract:

```bash
bun run build:schema
```

## Security model

- Authoring code executes locally, never on the Unbroker control plane.
- `preserve()` keeps an existing secret without retrieving it.
- `fromEnv("NAME")` reads CI or shell values at evaluation time.
- Plan output redacts literal variable values.
- Applying infrastructure is exclusively the responsibility of the authenticated
  Unbroker API.

Licensed under the [MIT License](./LICENSE).
