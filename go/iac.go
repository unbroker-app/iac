package iac

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
)

type Context struct {
	Command         string `json:"command"`
	ProjectID       string `json:"projectId"`
	ProjectName     string `json:"projectName"`
	EnvironmentID   string `json:"environmentId"`
	Environment     string `json:"environment"`
	EnvironmentName string `json:"environmentName"`
}

func (c Context) IsEnvironment(name string) bool { return c.EnvironmentName == name }

type PreserveValue struct {
	Unbroker string `json:"$unbroker"`
}

func Preserve() PreserveValue { return PreserveValue{Unbroker: "preserve"} }

func MustFromEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		panic(fmt.Sprintf("missing required environment variable %s", name))
	}
	return value
}

type Source struct {
	Type           string `json:"type"`
	URL            string `json:"url,omitempty"`
	Branch         string `json:"branch,omitempty"`
	Framework      string `json:"framework,omitempty"`
	DockerfilePath string `json:"dockerfilePath,omitempty"`
	RootDir        string `json:"rootDir,omitempty"`
	Ref            string `json:"ref,omitempty"`
	Public         *bool  `json:"public,omitempty"`
}

type RepositoryConfig struct {
	Branch         string
	Framework      string
	DockerfilePath string
	RootDir        string
}

func Repository(url string, config RepositoryConfig) Source {
	return Source{Type: "repository", URL: url, Branch: config.Branch, Framework: config.Framework, DockerfilePath: config.DockerfilePath, RootDir: config.RootDir}
}

type ImageConfig struct{ Public bool }

func Image(ref string, config ...ImageConfig) Source {
	public := false
	if len(config) > 0 {
		public = config[0].Public
	}
	return Source{Type: "image", Ref: ref, Public: Bool(public)}
}

type VolumeResource struct {
	resourceMarker
	Key    string
	Name   string
	SizeGB int
}

type VolumeConfig struct {
	Name   string
	SizeGB int
}

type VolumeMount struct {
	Volume *VolumeResource
	Path   string
}

func Volume(key string, config VolumeConfig) *VolumeResource {
	name := config.Name
	if name == "" {
		name = key
	}
	return &VolumeResource{Key: key, Name: name, SizeGB: config.SizeGB}
}

func (v *VolumeResource) Mount(path string) *VolumeMount {
	return &VolumeMount{Volume: v, Path: path}
}

type ServiceConfig struct {
	Name        string
	Source      Source
	Build       string
	PreDeploy   string
	Start       string
	OutputDir   string
	Port        int
	Healthcheck string
	Replicas    int
	CPULimit    int
	MemoryLimit int
	AutoDeploy  *bool
	WaitForCI   bool
	PRPreviews  bool
	Volume      *VolumeMount
	Env         map[string]any
	Domains     []string
}

func Bool(value bool) *bool { return &value }

type ServiceResource struct {
	resourceMarker
	Key    string
	Name   string
	Config ServiceConfig
	Host   string
	Port   string
	URL    string
	Slug   string
}

func Service(key string, config ServiceConfig) *ServiceResource {
	name := config.Name
	if name == "" {
		name = key
	}
	ref := func(output string) string { return fmt.Sprintf("${{services.%s.%s}}", key, output) }
	return &ServiceResource{Key: key, Name: name, Config: config, Host: ref("host"), Port: ref("port"), URL: ref("url"), Slug: ref("slug")}
}

func (s *ServiceResource) Env(key string) string {
	return fmt.Sprintf("${{services.%s.env.%s}}", s.Key, key)
}

type resourceMarker struct{}
type Resource interface{ isResource() }

func (*VolumeResource) isResource()  {}
func (*ServiceResource) isResource() {}

type ProjectConfig struct {
	Resources []Resource
	Env       map[string]any
}

type ProjectDefinition struct {
	Name      string
	Resources []Resource
	Env       map[string]any
}

func Project(name string, config ProjectConfig) ProjectDefinition {
	return ProjectDefinition{Name: name, Resources: config.Resources, Env: config.Env}
}

type DesiredState struct {
	Version int            `json:"version"`
	Project DesiredProject `json:"project"`
}

type DesiredProject struct {
	Name     string           `json:"name"`
	Env      map[string]any   `json:"env"`
	Services []DesiredService `json:"services"`
}

type DesiredService struct {
	Key         string         `json:"key"`
	Name        string         `json:"name"`
	Source      Source         `json:"source"`
	Build       *string        `json:"build"`
	PreDeploy   *string        `json:"preDeploy"`
	Start       *string        `json:"start"`
	OutputDir   *string        `json:"outputDir"`
	Port        int            `json:"port"`
	Healthcheck *string        `json:"healthcheck"`
	Replicas    int            `json:"replicas"`
	CPULimit    *int           `json:"cpuLimit"`
	MemoryLimit *int           `json:"memoryLimit"`
	AutoDeploy  bool           `json:"autoDeploy"`
	WaitForCI   bool           `json:"waitForCi"`
	PRPreviews  bool           `json:"prPreviews"`
	Volume      *DesiredVolume `json:"volume"`
	Env         map[string]any `json:"env"`
	Domains     []string       `json:"domains"`
}

type DesiredVolume struct {
	Path   string `json:"path"`
	SizeGB int    `json:"sizeGb"`
}

type Factory func(Context) ProjectDefinition
type Configuration struct{ factory Factory }

func DefineUnbroker(factory Factory) Configuration { return Configuration{factory: factory} }

var keyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,50}$`)
var envPattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	copy := value
	return &copy
}

func optionalInt(value int) *int {
	if value == 0 {
		return nil
	}
	copy := value
	return &copy
}

func (c Configuration) Evaluate(ctx Context) (DesiredState, error) {
	definition := c.factory(ctx)
	if definition.Name == "" {
		return DesiredState{}, errors.New("project name is required")
	}
	seen := map[string]Resource{}
	mounts := map[string]int{}
	services := []DesiredService{}
	for _, resource := range definition.Resources {
		var key string
		switch value := resource.(type) {
		case *VolumeResource:
			key = value.Key
		case *ServiceResource:
			key = value.Key
		default:
			return DesiredState{}, errors.New("unknown resource type")
		}
		if !keyPattern.MatchString(key) {
			return DesiredState{}, fmt.Errorf("invalid resource key %q", key)
		}
		if _, exists := seen[key]; exists {
			return DesiredState{}, fmt.Errorf("duplicate resource key %q", key)
		}
		seen[key] = resource
	}
	for _, resource := range definition.Resources {
		service, ok := resource.(*ServiceResource)
		if !ok {
			continue
		}
		config := service.Config
		if config.Source.Type != "repository" && config.Source.Type != "image" {
			return DesiredState{}, fmt.Errorf("service %q needs a source", service.Key)
		}
		if config.Source.Type == "repository" && config.Source.Branch == "" {
			config.Source.Branch = "main"
		}
		port := config.Port
		if port == 0 {
			port = 3000
		}
		replicas := config.Replicas
		if replicas == 0 {
			replicas = 1
		}
		autoDeploy := true
		if config.AutoDeploy != nil {
			autoDeploy = *config.AutoDeploy
		}
		if config.Healthcheck != "" && !strings.HasPrefix(config.Healthcheck, "/") {
			return DesiredState{}, fmt.Errorf("service %q healthcheck must start with /", service.Key)
		}
		for key := range config.Env {
			if !envPattern.MatchString(key) {
				return DesiredState{}, fmt.Errorf("invalid environment key %q", key)
			}
		}
		volume := (*DesiredVolume)(nil)
		if config.Volume != nil {
			declared, exists := seen[config.Volume.Volume.Key]
			if !exists || declared != config.Volume.Volume {
				return DesiredState{}, fmt.Errorf("service %q mounts an undeclared volume", service.Key)
			}
			if config.Volume.Volume.SizeGB < 1 {
				return DesiredState{}, fmt.Errorf("volume %q size must be positive", config.Volume.Volume.Key)
			}
			if replicas != 1 {
				return DesiredState{}, fmt.Errorf("volume-backed service %q must use one replica", service.Key)
			}
			mounts[config.Volume.Volume.Key]++
			volume = &DesiredVolume{Path: config.Volume.Path, SizeGB: config.Volume.Volume.SizeGB}
		}
		domains := append([]string(nil), config.Domains...)
		if domains == nil {
			domains = []string{}
		}
		sort.Strings(domains)
		services = append(services, DesiredService{Key: service.Key, Name: service.Name, Source: config.Source, Build: optionalString(config.Build), PreDeploy: optionalString(config.PreDeploy), Start: optionalString(config.Start), OutputDir: optionalString(config.OutputDir), Port: port, Healthcheck: optionalString(config.Healthcheck), Replicas: replicas, CPULimit: optionalInt(config.CPULimit), MemoryLimit: optionalInt(config.MemoryLimit), AutoDeploy: autoDeploy, WaitForCI: config.WaitForCI, PRPreviews: config.PRPreviews, Volume: volume, Env: nonNilMap(config.Env), Domains: domains})
	}
	for key, resource := range seen {
		if _, ok := resource.(*VolumeResource); ok && mounts[key] != 1 {
			return DesiredState{}, fmt.Errorf("volume %q must be mounted exactly once", key)
		}
	}
	return DesiredState{Version: 1, Project: DesiredProject{Name: definition.Name, Env: nonNilMap(definition.Env), Services: services}}, nil
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func Run(configuration Configuration) {
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintln(os.Stderr, recovered)
			os.Exit(1)
		}
	}()
	contextBytes, err := io.ReadAll(os.Stdin)
	if err != nil {
		fail(err)
	}
	var context Context
	if err := json.Unmarshal(contextBytes, &context); err != nil {
		fail(fmt.Errorf("invalid evaluator context: %w", err))
	}
	state, err := configuration.Evaluate(context)
	if err != nil {
		fail(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(state); err != nil {
		fail(err)
	}
}

func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
