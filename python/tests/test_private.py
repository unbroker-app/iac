import unittest

from unbroker_iac import Context, define_unbroker, image, project, repository, service


class PrivateExposureTests(unittest.TestCase):
    def evaluate(self, source, **config):
        configuration = define_unbroker(
            lambda _: project("acme", resources=[service("api", source=source, **config)])
        )
        return configuration.evaluate(Context.from_wire({}))["project"]["services"][0]

    def test_optional_exposure_and_image_routing(self):
        for private in (True, False):
            with self.subTest(private=private):
                result = self.evaluate(image("nginx:alpine"), private=private)
                self.assertEqual(result["private"], private)
                self.assertEqual(result["source"]["public"], not private)
                result = self.evaluate(repository("https://github.com/acme/api", framework="node"), private=private)
                self.assertEqual(result["private"], private)
        self.assertNotIn("private", self.evaluate(image("nginx:alpine")))

    def test_worker_rejects_explicit_exposure(self):
        for private in (True, False):
            with self.assertRaisesRegex(ValueError, "Workers don't listen"):
                self.evaluate(repository("https://github.com/acme/worker", framework="worker"), private=private)

    def test_rejects_non_boolean(self):
        with self.assertRaisesRegex(ValueError, "boolean"):
            self.evaluate(image("nginx:alpine"), private="true")
