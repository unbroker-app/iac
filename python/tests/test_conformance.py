import json
import pathlib
import unittest

from unbroker_iac import Context, define_unbroker, image, preserve, project, repository, service, volume


class ConformanceTest(unittest.TestCase):
    def test_basic_project(self):
        @define_unbroker
        def configuration(_ctx):
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
                build="bun run build",
                start="bun run start",
                port=3000,
                healthcheck="/health",
                replicas=2,
                env={"DATABASE_HOST": postgres.host},
                domains=["api.example.com"],
            )
            return project("acme", resources=[data, postgres, api])

        actual = configuration.evaluate(Context("plan", "", "", "", "production", "production"))
        fixture = pathlib.Path(__file__).parents[2] / "conformance" / "fixtures" / "basic-project.json"
        expected = json.loads(fixture.read_text())
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
