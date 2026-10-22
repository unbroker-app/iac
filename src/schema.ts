import { z } from "zod";

export const preserveValueSchema = z
  .object({ $unbroker: z.literal("preserve") })
  .strict();
export const variableValueSchema = z.union([
  z.string().min(1),
  preserveValueSchema,
]);
const envSchema = z.record(
  z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/)
    .max(128),
  variableValueSchema,
);
const keySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,50}$/);
const commandSchema = z
  .string()
  .min(1)
  .refine((value) => !/[\r\n]/.test(value), "Must not contain line breaks");
const relativePathSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((value) => !value.split("/").includes(".."))
  .refine((value) => !value.startsWith("/") && !value.startsWith("-"));
const frameworkSchema = z.enum([
  "nixpacks",
  "next",
  "astro",
  "node",
  "worker",
  "react",
  "vue",
  "vite",
  "static",
]);
const repoUrlSchema = z
  .string()
  .regex(
    /^https:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(?:\.git)?$/,
    "Use an HTTPS GitHub, GitLab or Bitbucket repository URL",
  );
const imageRefSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$/,
    "Must look like postgres:16 or ghcr.io/org/app:tag",
  );
const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .transform((value) => value.trim().toLowerCase())
  .refine(
    (value) =>
      /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/.test(
        value,
      ),
    "Must be a bare domain like app.example.com",
  );

const repositorySourceSchema = z
  .object({
    type: z.literal("repository"),
    url: repoUrlSchema,
    branch: z.string().min(1).default("main"),
    framework: frameworkSchema.optional(),
    dockerfilePath: relativePathSchema.optional(),
    rootDir: relativePathSchema.optional(),
  })
  .strict();
const imageSourceSchema = z
  .object({
    type: z.literal("image"),
    ref: imageRefSchema,
    public: z.boolean().default(false),
  })
  .strict();

export const desiredServiceSchema = z
  .object({
    key: keySchema,
    name: z.string().min(1).max(51),
    source: z.discriminatedUnion("type", [
      repositorySourceSchema,
      imageSourceSchema,
    ]),
    build: commandSchema.nullable().default(null),
    preDeploy: commandSchema.nullable().default(null),
    start: commandSchema.nullable().default(null),
    outputDir: relativePathSchema.nullable().default(null),
    port: z.coerce.number().int().positive().max(65535).default(3000),
    healthcheck: z.string().startsWith("/").max(200).nullable().default(null),
    replicas: z.coerce.number().int().min(1).max(300).default(1),
    cpuLimit: z.coerce
      .number()
      .int()
      .min(100)
      .max(2000)
      .nullable()
      .default(null),
    memoryLimit: z.coerce
      .number()
      .int()
      .min(128)
      .max(2048)
      .nullable()
      .default(null),
    autoDeploy: z.boolean().default(true),
    waitForCi: z.boolean().default(false),
    prPreviews: z.boolean().default(false),
    volume: z
      .object({
        path: z.string().startsWith("/").max(200),
        sizeGb: z.coerce.number().int().min(1).max(1000),
      })
      .strict()
      .nullable()
      .default(null),
    env: envSchema.default({}),
    domains: z
      .array(hostnameSchema)
      .max(100)
      .default([])
      .refine(
        (domains) => new Set(domains).size === domains.length,
        "Domains must be unique",
      ),
  })
  .strict()
  .superRefine((service, ctx) => {
    if (service.source.type === "image") {
      for (const field of ["build", "preDeploy", "outputDir"] as const)
        if (service[field] != null)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} only applies to repository services`,
          });
      if (!service.autoDeploy || service.waitForCi || service.prPreviews)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["autoDeploy"],
          message: "Git deployment settings only apply to repository services",
        });
      return;
    }
    const framework = service.source.framework != null;
    const dockerfile = service.source.dockerfilePath != null;
    if (framework === dockerfile && service.source.framework !== "worker")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", framework ? "dockerfilePath" : "framework"],
        message: "Choose exactly one build recipe: framework or dockerfilePath",
      });
  });

export const desiredStateSchema = z
  .object({
    version: z.literal(1),
    project: z
      .object({
        name: z.string().min(1).max(120),
        env: envSchema.default({}),
        services: z.array(desiredServiceSchema).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const keys = new Set<string>();
    for (const [index, service] of state.project.services.entries()) {
      if (keys.has(service.key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["project", "services", index, "key"],
          message: `Duplicate service key "${service.key}"`,
        });
      keys.add(service.key);
      if (service.volume && service.replicas > 1)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["project", "services", index, "replicas"],
          message: "A volume-backed service must use one replica",
        });
      if (service.volume && service.preDeploy)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["project", "services", index, "preDeploy"],
          message: "A volume-backed service cannot use a pre-deploy command",
        });
    }
  });

export type ParsedDesiredState = z.infer<typeof desiredStateSchema>;
export type ParsedDesiredService = z.infer<typeof desiredServiceSchema>;
export type ParsedVariableValue = z.infer<typeof variableValueSchema>;
