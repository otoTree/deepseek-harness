/** Windows DPAPI credential helper; credential bytes travel only over private stdio. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define MAX_CREDENTIAL_BYTES 65536
#define MAX_ENCRYPTED_BYTES (MAX_CREDENTIAL_BYTES + 4096)

static int fail(const wchar_t *operation) {
  fwprintf(stderr, L"Windows credential operation failed: %ls\n", operation);
  return 1;
}

static BOOL credential_path(const wchar_t *account, wchar_t *path, size_t path_capacity) {
  DWORD local_app_data_size = GetEnvironmentVariableW(L"LOCALAPPDATA", NULL, 0);
  if (local_app_data_size == 0) return FALSE;
  wchar_t *local_app_data = (wchar_t *)calloc((size_t)local_app_data_size, sizeof(wchar_t));
  if (local_app_data == NULL) return FALSE;
  if (GetEnvironmentVariableW(L"LOCALAPPDATA", local_app_data, local_app_data_size) == 0) {
    free(local_app_data);
    return FALSE;
  }

  size_t directory_length = wcslen(local_app_data) + wcslen(L"\\DeepSeek Harness\\Credentials") + 1;
  wchar_t *directory = (wchar_t *)calloc(directory_length, sizeof(wchar_t));
  if (directory == NULL) { free(local_app_data); return FALSE; }
  if (swprintf_s(directory, directory_length, L"%ls\\DeepSeek Harness\\Credentials", local_app_data) < 0) {
    free(directory);
    free(local_app_data);
    return FALSE;
  }
  free(local_app_data);

  wchar_t *parent = (wchar_t *)calloc(directory_length, sizeof(wchar_t));
  if (parent == NULL) { free(directory); return FALSE; }
  memcpy(parent, directory, directory_length * sizeof(wchar_t));
  wchar_t *separator = wcsrchr(parent, L'\\');
  if (separator == NULL) { free(parent); free(directory); return FALSE; }
  *separator = L'\0';
  if (!CreateDirectoryW(parent, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) {
    free(parent);
    free(directory);
    return FALSE;
  }
  free(parent);
  if (!CreateDirectoryW(directory, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) {
    free(directory);
    return FALSE;
  }

  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  DWORD object_size = 0;
  DWORD result_size = 0;
  BYTE digest[32];
  BYTE *hash_object = NULL;
  NTSTATUS status = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0);
  if (status >= 0) status = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&object_size, sizeof(object_size), &result_size, 0);
  if (status >= 0) hash_object = (BYTE *)malloc(object_size);
  if (status >= 0 && hash_object == NULL) status = STATUS_NO_MEMORY;
  if (status >= 0) status = BCryptCreateHash(algorithm, &hash, hash_object, object_size, NULL, 0, 0);
  if (status >= 0) status = BCryptHashData(hash, (PUCHAR)account, (ULONG)(wcslen(account) * sizeof(wchar_t)), 0);
  if (status >= 0) status = BCryptFinishHash(hash, digest, sizeof(digest), 0);
  if (hash != NULL) BCryptDestroyHash(hash);
  if (algorithm != NULL) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (hash_object != NULL) { SecureZeroMemory(hash_object, object_size); free(hash_object); }
  if (status < 0) { free(directory); return FALSE; }

  static const wchar_t hex[] = L"0123456789abcdef";
  size_t filename_length = 64 + wcslen(L".cred") + 1;
  wchar_t filename[70];
  for (size_t i = 0; i < sizeof(digest); i++) {
    filename[i * 2] = hex[digest[i] >> 4];
    filename[i * 2 + 1] = hex[digest[i] & 0x0f];
  }
  wcscpy_s(filename + 64, filename_length - 64, L".cred");
  BOOL written = swprintf_s(path, path_capacity, L"%ls\\%ls", directory, filename) >= 0;
  SecureZeroMemory(digest, sizeof(digest));
  free(directory);
  return written;
}

static BOOL read_stdin(BYTE **bytes, DWORD *length) {
  BYTE *buffer = (BYTE *)malloc(MAX_CREDENTIAL_BYTES + 1);
  if (buffer == NULL) return FALSE;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  DWORD total = 0;
  while (total <= MAX_CREDENTIAL_BYTES) {
    DWORD received = 0;
    DWORD available = (DWORD)(MAX_CREDENTIAL_BYTES + 1 - total);
    if (!ReadFile(input, buffer + total, available, &received, NULL)) {
      SecureZeroMemory(buffer, MAX_CREDENTIAL_BYTES + 1);
      free(buffer);
      return FALSE;
    }
    if (received == 0) break;
    total += received;
  }
  if (total == 0 || total > MAX_CREDENTIAL_BYTES) {
    SecureZeroMemory(buffer, MAX_CREDENTIAL_BYTES + 1);
    free(buffer);
    return FALSE;
  }
  *bytes = buffer;
  *length = total;
  return TRUE;
}

static BOOL write_stdout(const BYTE *bytes, DWORD length) {
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD offset = 0;
  while (offset < length) {
    DWORD written = 0;
    if (!WriteFile(output, bytes + offset, length - offset, &written, NULL) || written == 0) return FALSE;
    offset += written;
  }
  return TRUE;
}

static int set_credential(const wchar_t *path, const wchar_t *account) {
  BYTE *plain_bytes = NULL;
  DWORD plain_length = 0;
  if (!read_stdin(&plain_bytes, &plain_length)) return fail(L"read");
  DATA_BLOB plain = { plain_length, plain_bytes };
  DATA_BLOB entropy = { (DWORD)(wcslen(account) * sizeof(wchar_t)), (BYTE *)account };
  DATA_BLOB protected = { 0, NULL };
  if (!CryptProtectData(&plain, L"DeepSeek Harness enterprise credential", &entropy, NULL, NULL,
      CRYPTPROTECT_UI_FORBIDDEN, &protected)) {
    SecureZeroMemory(plain_bytes, plain_length);
    free(plain_bytes);
    return fail(L"protect");
  }
  SecureZeroMemory(plain_bytes, plain_length);
  free(plain_bytes);
  if (protected.cbData == 0 || protected.cbData > MAX_ENCRYPTED_BYTES) {
    SecureZeroMemory(protected.pbData, protected.cbData);
    LocalFree(protected.pbData);
    return fail(L"protect size");
  }

  wchar_t temporary[MAX_PATH * 2];
  if (swprintf_s(temporary, _countof(temporary), L"%ls.%lu.%llu.tmp", path,
      GetCurrentProcessId(), GetTickCount64()) < 0) {
    SecureZeroMemory(protected.pbData, protected.cbData);
    LocalFree(protected.pbData);
    return fail(L"temporary path");
  }
  HANDLE file = CreateFileW(temporary, GENERIC_WRITE, 0, NULL, CREATE_NEW,
      FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    SecureZeroMemory(protected.pbData, protected.cbData);
    LocalFree(protected.pbData);
    return fail(L"create");
  }
  DWORD written = 0;
  BOOL saved = WriteFile(file, protected.pbData, protected.cbData, &written, NULL)
      && written == protected.cbData && FlushFileBuffers(file);
  CloseHandle(file);
  SecureZeroMemory(protected.pbData, protected.cbData);
  LocalFree(protected.pbData);
  if (!saved || !MoveFileExW(temporary, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(temporary);
    return fail(L"save");
  }
  return 0;
}

static int get_credential(const wchar_t *path, const wchar_t *account) {
  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_FILE_NOT_FOUND ? 44 : fail(L"open");
  LARGE_INTEGER file_size;
  if (!GetFileSizeEx(file, &file_size) || file_size.QuadPart <= 0 || file_size.QuadPart > MAX_ENCRYPTED_BYTES) {
    CloseHandle(file);
    return fail(L"file size");
  }
  BYTE *encrypted_bytes = (BYTE *)malloc((size_t)file_size.QuadPart);
  if (encrypted_bytes == NULL) { CloseHandle(file); return fail(L"allocate"); }
  DWORD received = 0;
  BOOL loaded = ReadFile(file, encrypted_bytes, (DWORD)file_size.QuadPart, &received, NULL)
      && received == (DWORD)file_size.QuadPart;
  CloseHandle(file);
  if (!loaded) { free(encrypted_bytes); return fail(L"read"); }
  DATA_BLOB encrypted = { received, encrypted_bytes };
  DATA_BLOB entropy = { (DWORD)(wcslen(account) * sizeof(wchar_t)), (BYTE *)account };
  DATA_BLOB plain = { 0, NULL };
  BOOL unprotected = CryptUnprotectData(&encrypted, NULL, &entropy, NULL, NULL, CRYPTPROTECT_UI_FORBIDDEN, &plain);
  SecureZeroMemory(encrypted_bytes, received);
  free(encrypted_bytes);
  if (!unprotected) return fail(L"unprotect");
  BOOL written = write_stdout(plain.pbData, plain.cbData);
  SecureZeroMemory(plain.pbData, plain.cbData);
  LocalFree(plain.pbData);
  return written ? 0 : fail(L"write");
}

int wmain(int argc, wchar_t **argv) {
  if (argc != 3 || argv[1][0] == L'\0' || argv[2][0] == L'\0'
      || (wcscmp(argv[1], L"get") != 0 && wcscmp(argv[1], L"set") != 0 && wcscmp(argv[1], L"delete") != 0)) return 2;
  wchar_t path[MAX_PATH * 2];
  if (!credential_path(argv[2], path, _countof(path))) return fail(L"path");
  if (wcscmp(argv[1], L"set") == 0) return set_credential(path, argv[2]);
  if (wcscmp(argv[1], L"get") == 0) return get_credential(path, argv[2]);
  if (DeleteFileW(path) || GetLastError() == ERROR_FILE_NOT_FOUND) return 0;
  return fail(L"delete");
}
