package main

import iac "github.com/unbroker-app/iac/go"

func main() {
	configuration := iac.DefineUnbroker(func(ctx iac.Context) iac.ProjectDefinition {
		data := iac.Volume("postgres-data", iac.VolumeConfig{SizeGB: 20})
		postgres := iac.Service("postgres", iac.ServiceConfig{
			Source: iac.Image("postgres:17"),
			Port:   5432,
			Volume: data.Mount("/var/lib/postgresql/data"),
			Env:    map[string]any{"POSTGRES_PASSWORD": iac.Preserve()},
		})
		replicas := 1
		if ctx.IsEnvironment("production") {
			replicas = 3
		}
		api := iac.Service("api", iac.ServiceConfig{
			Source: iac.Repository("https://github.com/acme/platform", iac.RepositoryConfig{
				Branch:    "main",
				Framework: "node",
				RootDir:   "apps/api",
			}),
			Start:    "bun run start",
			Replicas: replicas,
			Env:      map[string]any{"DATABASE_HOST": postgres.Host},
		})
		return iac.Project("acme", iac.ProjectConfig{Resources: []iac.Resource{data, postgres, api}})
	})
	iac.Run(configuration)
}
