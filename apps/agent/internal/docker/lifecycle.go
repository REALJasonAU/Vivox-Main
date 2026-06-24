package docker

import (
	"fmt"
	"strings"
)

const (
	dataMountPath   = "/mnt/server"
	installMarker     = ".vivox-installed"
	envVivoxInstall   = "VIVOX_INSTALL_SCRIPT"
	envVivoxForce     = "VIVOX_FORCE_REINSTALL"
	envVivoxCPU       = "VIVOX_CPU_SHARES"
	envVivoxDisk      = "VIVOX_DISK_GB"
	envVivoxStartup   = "VIVOX_STARTUP_CMD"
	envVivoxInstallerImage    = "VIVOX_INSTALLER_IMAGE"
	envVivoxSkipInlineInstall = "VIVOX_SKIP_INLINE_INSTALL"
)

type runtimeEnv struct {
	CPUShares         int64
	DiskGB            int64
	StartupCmd        string
	InstallScript     string
	InstallerImage    string
	SkipInlineInstall bool
	ForceReinstall    bool
}

// dataVolumeName is the Docker volume holding per-service server files (/mnt/server).
func dataVolumeName(serviceID string) string {
	return "vivox-data-" + serviceID
}

// buildLifecycleScript produces the shell that runs install (once) then the server process.
// When startupCmd is empty the image's default entrypoint/cmd are executed after install.
func buildLifecycleScript(rt runtimeEnv, imageEntrypoint, imageCmd []string) string {
	var b strings.Builder
	b.WriteString("set -e\n")
	b.WriteString(fmt.Sprintf("mkdir -p %s\n", dataMountPath))
	b.WriteString(fmt.Sprintf("cd %s\n", dataMountPath))
	b.WriteString(fmt.Sprintf("MARKER=%q\n", installMarker))

	if rt.ForceReinstall && !rt.SkipInlineInstall {
		b.WriteString("rm -f \"$MARKER\"\n")
	}

	install := strings.TrimSpace(rt.InstallScript)
	if install != "" && !rt.SkipInlineInstall {
		b.WriteString("if [ ! -f \"$MARKER\" ]; then\n")
		b.WriteString("  echo '[vivox] === Installing server files ==='\n")
		b.WriteString(install)
		if !strings.HasSuffix(install, "\n") {
			b.WriteString("\n")
		}
		b.WriteString("  touch \"$MARKER\"\n")
		b.WriteString("  echo '[vivox] === Install complete ==='\n")
		b.WriteString("fi\n")
	}

	b.WriteString("echo '[vivox] === Starting server ==='\n")
	if strings.TrimSpace(rt.StartupCmd) != "" {
		b.WriteString("exec /bin/sh -c ")
		b.WriteString(shellQuote(rt.StartupCmd))
		b.WriteString("\n")
		return b.String()
	}

	if len(imageEntrypoint) > 0 || len(imageCmd) > 0 {
		args := append(append([]string{}, imageEntrypoint...), imageCmd...)
		b.WriteString("exec")
		for _, a := range args {
			b.WriteString(" ")
			b.WriteString(shellQuote(a))
		}
		b.WriteString("\n")
		return b.String()
	}

	b.WriteString("exec tail -f /dev/null\n")
	return b.String()
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}
