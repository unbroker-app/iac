from unbroker_iac import (
    define_unbroker,
    image,
    preserve,
    project,
    repository,
    run,
    service,
    volume,
)


@define_unbroker
def configuration(ctx):
    data = volume("postgres-data", size_gb=20)
    postgres = service(
        "postgres",
        source=image("postgres:17"),
        port=5432,
        volume=data.mount("/var/lib/postgresql/data"),
        env={"POSTGRES_PASSWORD": preserve()},
    )
    api = service(
        "api",
        source=repository(
            "https://github.com/acme/platform",
            branch="main",
            framework="node",
            root_dir="apps/api",
        ),
        start="bun run start",
        replicas=3 if ctx.is_environment("production") else 1,
        env={"DATABASE_HOST": postgres.host},
    )
    return project("acme", resources=[data, postgres, api])


if __name__ == "__main__":
    run(configuration)
