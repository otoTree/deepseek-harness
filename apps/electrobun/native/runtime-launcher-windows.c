/** Run the protected DSH CLI under a kill-on-close Windows Job Object. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#define COMMAND_CAPACITY 32767

static BOOL append_char(wchar_t *buffer, size_t capacity, size_t *length, wchar_t value) {
  if (*length + 1 >= capacity) return FALSE;
  buffer[(*length)++] = value;
  buffer[*length] = L'\0';
  return TRUE;
}

static BOOL append_slashes(wchar_t *buffer, size_t capacity, size_t *length, size_t count) {
  while (count-- > 0) if (!append_char(buffer, capacity, length, L'\\')) return FALSE;
  return TRUE;
}

static BOOL append_argument(wchar_t *buffer, size_t capacity, size_t *length, const wchar_t *argument) {
  if (!append_char(buffer, capacity, length, L'"')) return FALSE;
  size_t slashes = 0;
  for (const wchar_t *character = argument; *character != L'\0'; character++) {
    if (*character == L'\\') { slashes++; continue; }
    if (*character == L'"') {
      if (!append_slashes(buffer, capacity, length, slashes * 2 + 1)
          || !append_char(buffer, capacity, length, L'"')) return FALSE;
    } else {
      if (!append_slashes(buffer, capacity, length, slashes)
          || !append_char(buffer, capacity, length, *character)) return FALSE;
    }
    slashes = 0;
  }
  if (!append_slashes(buffer, capacity, length, slashes * 2)
      || !append_char(buffer, capacity, length, L'"')
      || !append_char(buffer, capacity, length, L' ')) return FALSE;
  return TRUE;
}

static BOOL executable_paths(wchar_t *node, size_t node_capacity, wchar_t *entry, size_t entry_capacity) {
  wchar_t executable[32768];
  DWORD length = GetModuleFileNameW(NULL, executable, _countof(executable));
  if (length == 0 || length >= _countof(executable)) return FALSE;
  wchar_t *separator = wcsrchr(executable, L'\\');
  if (separator == NULL) return FALSE;
  *separator = L'\0';
  return swprintf_s(node, node_capacity, L"%ls\\node.exe", executable) >= 0
      && swprintf_s(entry, entry_capacity, L"%ls\\runtime\\bin.js", executable) >= 0;
}

static HANDLE desktop_process(void) {
  wchar_t value[32];
  DWORD length = GetEnvironmentVariableW(L"DSH_DESKTOP_PARENT_PID", value, _countof(value));
  if (length == 0 || length >= _countof(value)) return NULL;
  wchar_t *end = NULL;
  unsigned long pid = wcstoul(value, &end, 10);
  if (pid == 0 || end == value || *end != L'\0') return NULL;
  return OpenProcess(SYNCHRONIZE, FALSE, (DWORD)pid);
}

int wmain(int argc, wchar_t **argv) {
  wchar_t node[32768];
  wchar_t entry[32768];
  wchar_t command_line[COMMAND_CAPACITY];
  if (!executable_paths(node, _countof(node), entry, _countof(entry))) {
    fputs("Cannot resolve packaged DSH runtime paths\n", stderr);
    return 127;
  }
  size_t command_length = 0;
  command_line[0] = L'\0';
  if (!append_argument(command_line, _countof(command_line), &command_length, node)
      || !append_argument(command_line, _countof(command_line), &command_length, entry)) {
    fputs("Packaged DSH command exceeds Windows command-line limits\n", stderr);
    return 127;
  }
  for (int i = 1; i < argc; i++) {
    if (!append_argument(command_line, _countof(command_line), &command_length, argv[i])) {
      fputs("Packaged DSH command exceeds Windows command-line limits\n", stderr);
      return 127;
    }
  }
  if (command_length > 0 && command_line[command_length - 1] == L' ') command_line[command_length - 1] = L'\0';

  HANDLE parent = desktop_process();
  if (parent == NULL) {
    fputs("Cannot monitor the owning desktop process\n", stderr);
    return 127;
  }
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) { CloseHandle(parent); return 127; }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = { 0 };
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    CloseHandle(job);
    CloseHandle(parent);
    return 127;
  }

  STARTUPINFOW startup = { 0 };
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process = { 0 };
  if (!CreateProcessW(node, command_line, NULL, NULL, TRUE,
      CREATE_SUSPENDED | CREATE_NO_WINDOW, NULL, NULL, &startup, &process)) {
    CloseHandle(job);
    CloseHandle(parent);
    return 127;
  }
  if (!AssignProcessToJobObject(job, process.hProcess) || ResumeThread(process.hThread) == (DWORD)-1) {
    TerminateProcess(process.hProcess, 127);
    WaitForSingleObject(process.hProcess, INFINITE);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    CloseHandle(parent);
    return 127;
  }
  CloseHandle(process.hThread);
  HANDLE waits[] = { process.hProcess, parent };
  DWORD result = WaitForMultipleObjects(_countof(waits), waits, FALSE, INFINITE);
  DWORD exit_code = 127;
  if (result == WAIT_OBJECT_0) {
    if (!GetExitCodeProcess(process.hProcess, &exit_code)) exit_code = 127;
  } else if (result == WAIT_OBJECT_0 + 1) {
    TerminateJobObject(job, 1);
    WaitForSingleObject(process.hProcess, INFINITE);
    exit_code = 1;
  }
  CloseHandle(process.hProcess);
  CloseHandle(parent);
  CloseHandle(job);
  return (int)exit_code;
}
