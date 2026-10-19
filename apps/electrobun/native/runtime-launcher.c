/** Replace the packaged DSH launcher with the adjacent Node runtime, retaining its PID and signals. */
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char executable[PATH_MAX], directory[PATH_MAX], node[PATH_MAX], entry[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || realpath(executable, directory) == NULL) {
    fputs("Cannot resolve packaged DSH executable\n", stderr);
    return 127;
  }
  *strrchr(directory, '/') = '\0';
  if ((size_t)snprintf(node, sizeof(node), "%s/node", directory) >= sizeof(node)
      || (size_t)snprintf(entry, sizeof(entry), "%s/runtime/bin.js", directory) >= sizeof(entry)) {
    fputs("Packaged DSH path exceeds PATH_MAX\n", stderr);
    return 127;
  }
  char **arguments = calloc((size_t)argc + 2, sizeof(char *));
  if (arguments == NULL) { perror("DSH launcher allocation"); return 127; }
  arguments[0] = node;
  arguments[1] = entry;
  for (int i = 1; i < argc; i++) arguments[i + 1] = argv[i];
  execv(node, arguments);
  perror("Cannot execute packaged Node runtime");
  free(arguments);
  return 127;
}
