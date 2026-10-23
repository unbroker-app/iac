# IaC evaluator protocol

`ubctl` uses this protocol to evaluate authoring files written in languages
other than TypeScript.

## Input

The evaluator receives one JSON object on standard input:

```json
{
  "command": "plan",
  "projectId": "prj_123",
  "projectName": "acme",
  "environmentId": "env_123",
  "environment": "production",
  "environmentName": "production"
}
```

Language SDKs may add convenience methods such as `IsEnvironment` or
`is_environment`, but must preserve these fields.

## Output

On success, stdout contains exactly one desired-state JSON document conforming
to [`schema/desired-state.schema.json`](./schema/desired-state.schema.json).
Diagnostics belong on stderr. The process exits `0` on success and non-zero on
failure.

## Execution limits

The CLI runs evaluators without a shell, limits execution to 30 seconds and
accepts at most 1 MiB on either output stream. The authoring process inherits
the CI environment so helpers such as `MustFromEnv`/`from_env` can read secrets.

Authoring code is trusted repository code and executes locally. It is never
uploaded to or executed by the Unbroker control plane.
