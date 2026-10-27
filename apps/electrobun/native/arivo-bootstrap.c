/** Prepare Arivo's install root before replacing this process with Electrobun. */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int directory_at(int parent, const char *name) {
  if (mkdirat(parent, name, 0700) != 0 && errno != EEXIST) return -1;
  int file = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (file < 0) return -1;
  struct stat info;
  if (fstat(file, &info) != 0 || info.st_uid != geteuid()
      || (info.st_mode & (S_IWGRP | S_IWOTH)) != 0) {
    close(file);
    errno = EPERM;
    return -1;
  }
  return file;
}

int main(int argc, char **argv) {
  (void)argc;
  const char *home = getenv("HOME");
  if (!home) {
    struct passwd *user = getpwuid(geteuid());
    if (user) home = user->pw_dir;
  }
  if (!home || home[0] != '/') {
    fputs("Arivo requires an absolute user home directory.\n", stderr);
    return 78;
  }
  int parent = open(home, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (parent < 0) { perror("Arivo user home"); return 74; }
  const char *parts[] = { "Library", "Application Support", "com.arivo.studio", "stable" };
  for (size_t i = 0; i < sizeof(parts) / sizeof(parts[0]); i++) {
    int next = directory_at(parent, parts[i]);
    close(parent);
    if (next < 0) { perror("Arivo install directory"); return 74; }
    parent = next;
  }
  close(parent);

  char executable[PATH_MAX], resolved[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) {
    fputs("Arivo could not resolve its launcher.\n", stderr);
    return 74;
  }
  char *name = strrchr(resolved, '/');
  const char *delegate = "electrobun-launcher";
  if (!name || (size_t)(name + 1 - resolved) + strlen(delegate) >= sizeof(resolved)) return 74;
  strcpy(name + 1, delegate);
  argv[0] = resolved;
  execv(resolved, argv);
  perror("Arivo native launcher");
  return 74;
}
