import type {
  DesiredState,
  EvaluationContext,
  ImageSource,
  ProjectDefinition,
  RepositorySource,
  ServiceConfig,
  ServiceResource,
  UnbrokerConfiguration,
  VolumeResource,
} from "./types.ts";
import { desiredStateSchema } from "./schema.ts";

export type * from "./types.ts";
export {
  desiredServiceSchema,
  desiredStateSchema,
  preserveValueSchema,
  variableValueSchema,
} from "./schema.ts";
export type {
  ParsedDesiredService,
  ParsedDesiredState,
  ParsedVariableValue,
} from "./schema.ts";

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,50}$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key))
    throw new Error(
      `Invalid resource key "${key}"; use lowercase letters, numbers and dashes`,
    );
}

export function preserve() {
  return { $unbroker: "preserve" } as const;
}

/** Read a secret or other value from the process running the IaC evaluation.
 * The resulting desired-state document contains the value, so callers should
 * send it only to Unbroker's plan endpoint and must never print it. */
export function fromEnv(
  name: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  const value = environment[name];
  if (value == null || value === "")
    throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function repository(
  url: string,
  config: Omit<RepositorySource, "type" | "url"> = {},
): RepositorySource {
  return { type: "repository", url, ...config };
}

export function image(
  ref: string,
  config: Omit<ImageSource, "type" | "ref"> = {},
): ImageSource {
  return { type: "image", ref, ...config };
}

export function volume(
  key: string,
  config: { name?: string; sizeGb: number },
): VolumeResource {
  assertKey(key);
  const resource: VolumeResource = {
    kind: "volume",
    key,
    name: config.name ?? key,
    sizeGb: config.sizeGb,
    mount: (path) => ({ volume: resource, path }),
  };
  return resource;
}

export function service(key: string, config: ServiceConfig): ServiceResource {
  assertKey(key);
  const ref = (output: string) => `\${{services.${key}.${output}}}`;
  return {
    kind: "service",
    key,
    name: config.name ?? key,
    config,
    host: ref("host"),
    port: ref("port"),
    url: ref("url"),
    slug: ref("slug"),
    env: new Proxy(
      {},
      {
        get: (_target, envKey) => {
          if (typeof envKey !== "string" || envKey === "then") return undefined;
          if (!/^[A-Z_][A-Z0-9_]*$/.test(envKey))
            throw new Error(
              `Invalid environment-variable reference "${envKey}" on service "${key}"`,
            );
          return ref(`env.${envKey}`);
        },
      },
    ),
  };
}

export function project(
  name: string,
  config: {
    resources: (ServiceResource | VolumeResource)[];
    env?: ProjectDefinition["env"];
  },
): ProjectDefinition {
  return {
    kind: "project",
    name,
    env: config.env ?? {},
    resources: config.resources,
  };
}

function compile(definition: ProjectDefinition): DesiredState {
  const resources = new Map(definition.resources.map((r) => [r.key, r]));
  if (resources.size !== definition.resources.length)
    throw new Error("Resource keys must be unique");

  const volumeMounts = new Map<string, number>();

  const services = definition.resources
    .filter(
      (resource): resource is ServiceResource => resource.kind === "service",
    )
    .map((resource) => {
      const { config } = resource;
      if (
        config.volume &&
        resources.get(config.volume.volume.key) !== config.volume.volume
      )
        throw new Error(
          `Service "${resource.key}" mounts an undeclared volume "${config.volume.volume.key}"`,
        );
      if (config.volume)
        volumeMounts.set(
          config.volume.volume.key,
          (volumeMounts.get(config.volume.volume.key) ?? 0) + 1,
        );
      return {
        key: resource.key,
        name: resource.name,
        source: config.source,
        build: config.build ?? null,
        preDeploy: config.preDeploy ?? null,
        start: config.start ?? null,
        outputDir: config.outputDir ?? null,
        port: config.port ?? 3000,
        healthcheck: config.healthcheck ?? null,
        replicas: config.replicas ?? 1,
        cpuLimit: config.cpuLimit ?? null,
        memoryLimit: config.memoryLimit ?? null,
        autoDeploy: config.autoDeploy ?? true,
        waitForCi: config.waitForCi ?? false,
        prPreviews: config.prPreviews ?? false,
        volume: config.volume
          ? {
              path: config.volume.path,
              sizeGb: config.volume.volume.sizeGb,
            }
          : null,
        env: config.env ?? {},
        domains: [...new Set(config.domains ?? [])].sort(),
      };
    });

  for (const resource of definition.resources) {
    if (resource.kind !== "volume") continue;
    const mounts = volumeMounts.get(resource.key) ?? 0;
    if (mounts !== 1)
      throw new Error(
        `Volume "${resource.key}" must be mounted by exactly one service`,
      );
  }

  return {
    version: 1,
    project: {
      name: definition.name,
      env: definition.env,
      services,
    },
  };
}

export function defineUnbroker(
  factory: (context: EvaluationContext) => ProjectDefinition,
): UnbrokerConfiguration {
  return {
    evaluate: (context) => desiredStateSchema.parse(compile(factory(context))),
  };
}
