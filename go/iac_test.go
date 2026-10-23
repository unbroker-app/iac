package iac

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestBasicProjectConformance(t *testing.T) {
	config := DefineUnbroker(func(Context) ProjectDefinition {
		data := Volume("postgres-data", VolumeConfig{SizeGB: 20})
		postgres := Service("postgres", ServiceConfig{Source: Image("postgres:17"), Port: 5432, Volume: data.Mount("/var/lib/postgresql/data"), Env: map[string]any{"POSTGRES_PASSWORD": Preserve()}})
		api := Service("api", ServiceConfig{Source: Repository("https://github.com/acme/platform", RepositoryConfig{Branch: "main", Framework: "node", RootDir: "apps/api"}), Build: "bun run build", Start: "bun run start", Port: 3000, Healthcheck: "/health", Replicas: 2, Env: map[string]any{"DATABASE_HOST": postgres.Host}, Domains: []string{"api.example.com"}})
		return Project("acme", ProjectConfig{Resources: []Resource{data, postgres, api}})
	})
	actual, err := config.Evaluate(Context{})
	if err != nil {
		t.Fatal(err)
	}
	expectedBytes, err := os.ReadFile(filepath.Join("..", "conformance", "fixtures", "basic-project.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected DesiredState
	if err := json.Unmarshal(expectedBytes, &expected); err != nil {
		t.Fatal(err)
	}
	actualBytes, _ := json.Marshal(actual)
	expectedNormalized, _ := json.Marshal(expected)
	if string(actualBytes) != string(expectedNormalized) {
		t.Fatalf("conformance mismatch\nactual: %s\nexpected: %s", actualBytes, expectedNormalized)
	}
}
