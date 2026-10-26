from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

VariableValue = Union[str, Dict[str, str]]
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,50}$")
ENV_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")


@dataclass(frozen=True)
class Context:
    command: str
    project_id: str
    project_name: str
    environment_id: str
    environment: str
    environment_name: str

    def is_environment(self, name: str) -> bool:
        return self.environment_name == name

    @classmethod
    def from_wire(cls, value: Dict[str, Any]) -> "Context":
        return cls(
            command=value.get("command", "plan"),
            project_id=value.get("projectId", ""),
            project_name=value.get("projectName", ""),
            environment_id=value.get("environmentId", ""),
            environment=value.get("environment", ""),
            environment_name=value.get("environmentName", value.get("environment", "")),
        )


def preserve() -> Dict[str, str]:
    return {"$unbroker": "preserve"}


def from_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"missing required environment variable {name}")
    return value


def repository(
    url: str,
    *,
    branch: str = "main",
    framework: Optional[str] = None,
    dockerfile_path: Optional[str] = None,
    root_dir: Optional[str] = None,
) -> Dict[str, Any]:
    source: Dict[str, Any] = {"type": "repository", "url": url, "branch": branch}
    if framework is not None:
        source["framework"] = framework
    if dockerfile_path is not None:
        source["dockerfilePath"] = dockerfile_path
    if root_dir is not None:
        source["rootDir"] = root_dir
    return source


def image(ref: str, *, public: bool = False) -> Dict[str, Any]:
    return {"type": "image", "ref": ref, "public": public}


@dataclass
class VolumeMount:
    volume: "VolumeResource"
    path: str


@dataclass
class VolumeResource:
    key: str
    size_gb: int
    name: str
    kind: str = field(default="volume", init=False)

    def mount(self, path: str) -> VolumeMount:
        return VolumeMount(volume=self, path=path)


def volume(key: str, *, size_gb: int, name: Optional[str] = None) -> VolumeResource:
    _assert_key(key)
    return VolumeResource(key=key, size_gb=size_gb, name=name or key)


class EnvReferences:
    def __init__(self, service_key: str):
        self._service_key = service_key

    def __getattr__(self, key: str) -> str:
        if not ENV_RE.fullmatch(key):
            raise AttributeError(f"invalid environment-variable reference {key!r}")
        return f"${{{{services.{self._service_key}.env.{key}}}}}"


@dataclass
class ServiceResource:
    key: str
    config: Dict[str, Any]
    name: str
    kind: str = field(default="service", init=False)

    @property
    def host(self) -> str:
        return self._ref("host")

    @property
    def port(self) -> str:
        return self._ref("port")

    @property
    def url(self) -> str:
        return self._ref("url")

    @property
    def slug(self) -> str:
        return self._ref("slug")

    @property
    def env(self) -> EnvReferences:
        return EnvReferences(self.key)

    def _ref(self, output: str) -> str:
        return f"${{{{services.{self.key}.{output}}}}}"


def service(key: str, *, source: Dict[str, Any], name: Optional[str] = None, **config: Any) -> ServiceResource:
    _assert_key(key)
    return ServiceResource(key=key, name=name or key, config={"source": source, **config})


Resource = Union[VolumeResource, ServiceResource]


@dataclass
class ProjectDefinition:
    name: str
    resources: Sequence[Resource]
    env: Dict[str, VariableValue]


def project(name: str, *, resources: Sequence[Resource], env: Optional[Dict[str, VariableValue]] = None) -> ProjectDefinition:
    return ProjectDefinition(name=name, resources=resources, env=env or {})


Factory = Callable[[Context], ProjectDefinition]


class Configuration:
    def __init__(self, factory: Factory):
        self._factory = factory

    def evaluate(self, context: Context) -> Dict[str, Any]:
        return _compile(self._factory(context))


def define_unbroker(factory: Factory) -> Configuration:
    return Configuration(factory)


def _assert_key(key: str) -> None:
    if not KEY_RE.fullmatch(key):
        raise ValueError(f"invalid resource key {key!r}")


def _nullable(value: Any) -> Any:
    return value if value is not None else None


def _compile(definition: ProjectDefinition) -> Dict[str, Any]:
    if not definition.name:
        raise ValueError("project name is required")
    declared: Dict[str, Resource] = {}
    for resource in definition.resources:
        _assert_key(resource.key)
        if resource.key in declared:
            raise ValueError(f"duplicate resource key {resource.key!r}")
        declared[resource.key] = resource

    mounts: Dict[str, int] = {}
    services: List[Dict[str, Any]] = []
    for resource in definition.resources:
        if not isinstance(resource, ServiceResource):
            continue
        config = resource.config
        source = dict(config["source"])
        source_type = source.get("type")
        if source_type not in ("repository", "image"):
            raise ValueError(f"service {resource.key!r} needs a source")
        if source_type == "repository":
            source.setdefault("branch", "main")
        exposure = {}
        if "private" in config:
            private = config["private"]
            if not isinstance(private, bool):
                raise ValueError("private must be a boolean")
            if source_type == "repository" and source.get("framework") == "worker":
                raise ValueError("Workers don't listen, so they can't be marked private")
            exposure["private"] = private
            if source_type == "image":
                source["public"] = not private
        port = int(config.get("port", 3000))
        replicas = int(config.get("replicas", 1))
        env = dict(config.get("env", {}))
        for key in env:
            if not ENV_RE.fullmatch(key):
                raise ValueError(f"invalid environment key {key!r}")
        mount = config.get("volume")
        desired_volume = None
        if mount is not None:
            if not isinstance(mount, VolumeMount) or declared.get(mount.volume.key) is not mount.volume:
                raise ValueError(f"service {resource.key!r} mounts an undeclared volume")
            if mount.volume.size_gb < 1:
                raise ValueError(f"volume {mount.volume.key!r} size must be positive")
            if replicas != 1:
                raise ValueError(f"volume-backed service {resource.key!r} must use one replica")
            mounts[mount.volume.key] = mounts.get(mount.volume.key, 0) + 1
            desired_volume = {"path": mount.path, "sizeGb": mount.volume.size_gb}
        domains = sorted(set(config.get("domains", [])))
        services.append(
            {
                "key": resource.key,
                "name": resource.name,
                "source": source,
                **exposure,
                "build": _nullable(config.get("build")),
                "preDeploy": _nullable(config.get("pre_deploy")),
                "start": _nullable(config.get("start")),
                "outputDir": _nullable(config.get("output_dir")),
                "port": port,
                "healthcheck": _nullable(config.get("healthcheck")),
                "replicas": replicas,
                "cpuLimit": _nullable(config.get("cpu_limit")),
                "memoryLimit": _nullable(config.get("memory_limit")),
                "autoDeploy": bool(config.get("auto_deploy", True)),
                "waitForCi": bool(config.get("wait_for_ci", False)),
                "prPreviews": bool(config.get("pr_previews", False)),
                "volume": desired_volume,
                "env": env,
                "domains": domains,
            }
        )
    for key, resource in declared.items():
        if isinstance(resource, VolumeResource) and mounts.get(key) != 1:
            raise ValueError(f"volume {key!r} must be mounted exactly once")
    return {"version": 1, "project": {"name": definition.name, "env": definition.env, "services": services}}


def run(configuration: Configuration) -> None:
    try:
        context = Context.from_wire(json.load(sys.stdin))
        json.dump(configuration.evaluate(context), sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error


__all__ = [
    "Configuration",
    "Context",
    "define_unbroker",
    "from_env",
    "image",
    "preserve",
    "project",
    "repository",
    "run",
    "service",
    "volume",
]
