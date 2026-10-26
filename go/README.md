# Unbroker IaC Go SDK

```bash
go get github.com/unbroker-app/iac@v0.3.0
```

Import the authoring package:

```go
import iac "github.com/unbroker-app/iac/go"
```

Go authoring programs receive evaluation context on stdin and emit the canonical
desired-state JSON on stdout through `iac.Run(configuration)`.
