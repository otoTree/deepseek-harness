/** Hold a kernel-owned Arivo home lock until its Host closes stdin or exits. */
#include <stdio.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

int wmain(int argc, wchar_t **argv) {
  if (argc != 2) return 64;
  HANDLE file = CreateFileW(argv[1], GENERIC_READ | GENERIC_WRITE, 0, NULL,
    OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (file == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_SHARING_VIOLATION ? 73 : 74;
  BY_HANDLE_FILE_INFORMATION info;
  if (!GetFileInformationByHandle(file, &info)
      || (info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) {
    CloseHandle(file);
    return 74;
  }
  fputs("arivo-instance-ready\n", stdout);
  fflush(stdout);
  while (getchar() != EOF) {}
  CloseHandle(file);
  return 0;
}
#else
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  int file = open(argv[1], O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (file < 0) return 74;
  struct stat info;
  if (fstat(file, &info) != 0 || !S_ISREG(info.st_mode)) { close(file); return 74; }
  if (flock(file, LOCK_EX | LOCK_NB) != 0) {
    int code = errno == EWOULDBLOCK ? 73 : 74;
    close(file);
    return code;
  }
  fputs("arivo-instance-ready\n", stdout);
  fflush(stdout);
  while (getchar() != EOF) {}
  close(file);
  return 0;
}
#endif
