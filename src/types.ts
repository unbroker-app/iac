export interface PreserveValue {
  readonly $unbroker: "preserve";
}

export type VariableValue = string | PreserveValue;

export interface EvaluationContext {
  command: "pull" | "plan" | "apply";
  projectId: string;
  projectName: string;
  environmentId: string;
  environment: string;
  environmentName: string;
  isEnvironment(name: string): boolean;
}

export interface RepositorySource {
  type: "repository";
  url: string;
  branch?: string;
  framework?:
    | "nixpacks"
    | "next"
    | "astro"
    | "node"
    | "worker"
    | "react"
    | "vue"
    | "vite"
    | "static";
  dockerfilePath?: string;
  rootDir?: string;
}

export interface ImageSource {
  type: "image";
  ref: string;
  public?: boolean;
}

export type ServiceSource = RepositorySource | ImageSource;

export interface VolumeResource {
  readonly kind: "volume";
  readonly key: string;
  readonly name: string;
  readonly sizeGb: number;
  mount(path: string): VolumeMount;
}

export interface VolumeMount {
  readonly volume: VolumeResource;
  readonly path: string;
}

export interface ServiceConfig {
  name?: string;
  source: ServiceSource;
  /** Disable public routing; the service remains reachable on its internal host. */
  private?: boolean;
  build?: string;
  preDeploy?: string;
  start?: string;
  outputDir?: string;
  port?: number;
  healthcheck?: string;
  replicas?: number;
  cpuLimit?: number;
  memoryLimit?: number;
  autoDeploy?: boolean;
  waitForCi?: boolean;
  prPreviews?: boolean;
  volume?: VolumeMount;
  env?: Record<string, VariableValue>;
  domains?: string[];
}

export interface ServiceResource {
  readonly kind: "service";
  readonly key: string;
  readonly name: string;
  readonly config: ServiceConfig;
  readonly host: string;
  readonly port: string;
  readonly url: string;
  readonly slug: string;
  readonly env: Record<string, string>;
}

export type Resource = ServiceResource | VolumeResource;

export interface ProjectDefinition {
  readonly kind: "project";
  readonly name: string;
  readonly env: Record<string, VariableValue>;
  readonly resources: Resource[];
}

export interface DesiredService {
  key: string;
  name: string;
  source: ServiceSource;
  private?: boolean;
  build: string | null;
  preDeploy: string | null;
  start: string | null;
  outputDir: string | null;
  port: number;
  healthcheck: string | null;
  replicas: number;
  cpuLimit: number | null;
  memoryLimit: number | null;
  autoDeploy: boolean;
  waitForCi: boolean;
  prPreviews: boolean;
  volume: { path: string; sizeGb: number } | null;
  env: Record<string, VariableValue>;
  domains: string[];
}

export interface DesiredState {
  version: 1;
  project: {
    name: string;
    env: Record<string, VariableValue>;
    services: DesiredService[];
  };
}

export interface UnbrokerConfiguration {
  evaluate(context: EvaluationContext): DesiredState;
}
