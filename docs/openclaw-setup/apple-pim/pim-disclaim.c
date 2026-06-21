// pim-disclaim.c — self-locating "responsibility disclaim" launcher for the
// Apple-PIM Swift CLIs (reminder-cli, contacts-cli, calendar-cli, mail-cli).
//
// WHY THIS EXISTS
// ---------------
// The Swift CLIs are the real EventKit / Contacts clients, but they are spawned
// by node (the OpenClaw gateway, or the apple-pim MCP server). macOS attributes
// a spawned CLI's TCC permission to its "responsible process" — which, for a
// short-lived child of node, is node itself. Homebrew's node is ad-hoc signed,
// so every `brew upgrade node@22` changes node's binary identity and silently
// invalidates the Reminders/Contacts/Calendar grants. The symptom is:
//
//   Reminders → EKCADErrorDomain Code=1015  (XPC to calaccessd refused)
//   Contacts  → CNErrorDomain  Code=100     (Access Denied)
//
// THE FIX
// -------
// Interpose this launcher in front of each CLI. It re-spawns the real CLI with
// macOS *responsibility disclaimed* (responsibility_spawnattrs_setdisclaim — the
// same SPI terminal emulators use so child shells get their own TCC identity).
// The real CLI then becomes its OWN TCC principal: a stable path + signature,
// independent of whichever node binary invoked it. Grant once, survives every
// future node upgrade.
//
// INSTALL SHAPE (see install-disclaim-wrappers.sh)
// ------------------------------------------------
//   <release-dir>/reminder-cli        <- a copy of this launcher
//   <release-dir>/reminder-cli.real   <- the real Swift binary (the TCC principal)
//
// The launcher finds its own directory, derives the CLI name from argv[0]
// (so it works when invoked through the ~/.local/bin symlink), and execs the
// sibling "<name>.real". No paths are baked in — the same binary works at any
// install location.

#include <errno.h>
#include <dlfcn.h>
#include <libgen.h>
#include <limits.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
#include <mach-o/dyld.h> // _NSGetExecutablePath

extern char **environ;

// Embedded marker so the installer can distinguish a wrapped launcher from the
// real Swift binary (used for safe, idempotent re-runs). Bump the version suffix
// only if the launcher's install contract changes.
__attribute__((used)) static const char PIM_DISCLAIM_MARKER[] =
    "PIM-DISCLAIM-WRAPPER-v1";

// Private libSystem SPI; not declared in any SDK header. Resolved at runtime via
// dlsym so a missing symbol degrades gracefully instead of failing to link.
typedef int (*setdisclaim_fn)(posix_spawnattr_t *, int);

static volatile pid_t g_child = 0;

static void forward_signal(int sig) {
  if (g_child > 0) kill(g_child, sig);
}

int main(int argc, char **argv) {
  // 1. Resolve this launcher's own real path, then its directory.
  char self[PATH_MAX];
  uint32_t sz = sizeof self;
  if (_NSGetExecutablePath(self, &sz) != 0) {
    fprintf(stderr, "pim-disclaim: executable path too long\n");
    return 127;
  }
  char resolved[PATH_MAX];
  if (!realpath(self, resolved)) {
    fprintf(stderr, "pim-disclaim: realpath(%s): %s\n", self, strerror(errno));
    return 127;
  }
  char dirbuf[PATH_MAX];
  snprintf(dirbuf, sizeof dirbuf, "%s", resolved);
  const char *dir = dirname(dirbuf);

  // 2. Derive the requested CLI name from argv[0] (handles symlink invocation).
  char namebuf[PATH_MAX];
  snprintf(namebuf, sizeof namebuf, "%s", argv[0]);
  const char *name = basename(namebuf);

  char target[PATH_MAX];
  if ((size_t)snprintf(target, sizeof target, "%s/%s.real", dir, name) >= sizeof target) {
    fprintf(stderr, "pim-disclaim: target path too long\n");
    return 127;
  }

  // 3. Build spawn attributes with responsibility disclaimed.
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  setdisclaim_fn set_disclaim =
      (setdisclaim_fn)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
  if (set_disclaim) {
    set_disclaim(&attr, 1);
  } else {
    fprintf(stderr,
            "pim-disclaim: WARNING responsibility_spawnattrs_setdisclaim "
            "unavailable; TCC may attribute to the calling process\n");
  }

  // 4. Forward argv[1..] to the real binary.
  char **child_argv = calloc((size_t)argc + 1, sizeof *child_argv);
  if (!child_argv) {
    fprintf(stderr, "pim-disclaim: out of memory\n");
    return 127;
  }
  child_argv[0] = target;
  for (int i = 1; i < argc; i++) child_argv[i] = argv[i];

  // Relay termination signals to the child (the MCP server SIGTERMs on timeout).
  signal(SIGTERM, forward_signal);
  signal(SIGINT, forward_signal);

  pid_t pid;
  int rc = posix_spawn(&pid, target, NULL, &attr, child_argv, environ);
  posix_spawnattr_destroy(&attr);
  free(child_argv);
  if (rc != 0) {
    fprintf(stderr, "pim-disclaim: spawn %s: %s\n", target, strerror(rc));
    return 127;
  }
  g_child = pid;

  // 5. Wait and propagate the child's exit status.
  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) {
      fprintf(stderr, "pim-disclaim: waitpid: %s\n", strerror(errno));
      return 127;
    }
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}
