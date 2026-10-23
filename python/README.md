# Unbroker IaC Python SDK

```bash
python3 -m pip install \
  "unbroker-iac @ git+https://github.com/unbroker-app/iac.git@v0.2.0#subdirectory=python"
```

Authoring programs receive evaluation context on stdin and emit the canonical
desired-state JSON on stdout through `run(configuration)`.
