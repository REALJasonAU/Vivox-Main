package docker

import "testing"

func TestBuildLifecycleScript_installThenStartup(t *testing.T) {
	script := buildLifecycleScript(runtimeEnv{
		InstallScript: "echo install",
		StartupCmd:    "echo start",
	}, nil, nil)
	for _, part := range []string{"Installing server files", "echo install", "exec /bin/sh -c 'echo start'"} {
		if !stringsContains(script, part) {
			t.Fatalf("missing %q in:\n%s", part, script)
		}
	}
}

func TestBuildLifecycleScript_forceReinstall(t *testing.T) {
	script := buildLifecycleScript(runtimeEnv{ForceReinstall: true, InstallScript: "true"}, nil, nil)
	if !stringsContains(script, `rm -f "$MARKER"`) {
		t.Fatalf("missing marker removal:\n%s", script)
	}
}

func TestBuildLifecycleScript_skipInlineInstall(t *testing.T) {
	script := buildLifecycleScript(runtimeEnv{
		ForceReinstall:    true,
		SkipInlineInstall: true,
		InstallScript:     "echo install",
		StartupCmd:        "echo start",
	}, nil, nil)
	if stringsContains(script, `rm -f "$MARKER"`) {
		t.Fatalf("should not remove marker when skip inline install:\n%s", script)
	}
	if stringsContains(script, "Installing server files") {
		t.Fatalf("should not inline install when skip inline install:\n%s", script)
	}
}

func TestBuildLifecycleScript_imageDefaultCmd(t *testing.T) {
	script := buildLifecycleScript(runtimeEnv{InstallScript: "true"}, []string{"/docker-entrypoint.sh"}, []string{"nginx", "-g", "daemon off;"})
	if !stringsContains(script, "exec '/docker-entrypoint.sh' 'nginx'") {
		t.Fatalf("unexpected script:\n%s", script)
	}
}

func TestPeelRuntimeEnv_installAndForce(t *testing.T) {
	env := map[string]string{
		envVivoxInstall:   "echo hi",
		envVivoxForce:     "1",
		envVivoxStartup:   "./game",
		envVivoxCPU:       "1024",
		"HOSTNAME":        "test",
	}
	out, rt := peelRuntimeEnv(env)
	if out["HOSTNAME"] != "test" {
		t.Fatalf("user env leaked: %#v", out)
	}
	if rt.InstallScript != "echo hi" || !rt.ForceReinstall || rt.StartupCmd != "./game" || rt.CPUShares != 1024 {
		t.Fatalf("runtime env: %#v", rt)
	}
}

func stringsContains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && stringIndex(s, sub) >= 0)
}

func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
