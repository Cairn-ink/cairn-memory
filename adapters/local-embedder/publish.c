/* Release-build input, Apache-2.0. Never compiled by the installer. The release
 * catalog must bind the resulting runtime/cairn-publish binary and this source.
 * Exit 0: published; 2: destination/fence conflict; 3: unavailable. No output. */
#define _GNU_SOURCE
#define _DARWIN_C_SOURCE
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <inttypes.h>
#ifdef __linux__
#include <sys/syscall.h>
#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE 1
#endif
#endif
static int component(const char *s) {
  return *s && strcmp(s, ".") && strcmp(s, "..") && !strchr(s, '/');
}
static int decimal(const char *s, uintmax_t *out) {
  if (!*s || (*s == '0' && s[1])) return 0;
  for (const char *p = s; *p; p++) if (*p < '0' || *p > '9') return 0;
  errno = 0; char *end = NULL; *out = strtoumax(s, &end, 10);
  return !errno && end && !*end;
}
int main(int argc, char **argv) {
  if (argc != 8 || !component(argv[2]) || !component(argv[3])) return 3;
  uintmax_t parent_dev, parent_ino, source_dev, source_ino;
  if (!decimal(argv[4], &parent_dev) || !decimal(argv[5], &parent_ino) ||
      !decimal(argv[6], &source_dev) || !decimal(argv[7], &source_ino)) return 3;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return 3;
  struct stat parent, source;
  if (fstat(fd, &parent) || (uintmax_t)parent.st_dev != parent_dev ||
      (uintmax_t)parent.st_ino != parent_ino || parent.st_uid != getuid() ||
      (parent.st_mode & 0022) || fstatat(fd, argv[2], &source, AT_SYMLINK_NOFOLLOW) ||
      !S_ISDIR(source.st_mode) || (uintmax_t)source.st_dev != source_dev ||
      (uintmax_t)source.st_ino != source_ino) { close(fd); return 2; }
  int rc;
#if defined(__linux__) && defined(SYS_renameat2)
  rc = (int)syscall(SYS_renameat2, fd, argv[2], fd, argv[3], RENAME_NOREPLACE);
#elif defined(__APPLE__)
  rc = renameatx_np(fd, argv[2], fd, argv[3], RENAME_EXCL);
#else
  close(fd); return 3;
#endif
  int saved = errno;
  if (rc == 0) { int durable = fsync(fd); close(fd); return durable ? 3 : 0; }
  close(fd);
  return saved == EEXIST || saved == ENOTEMPTY ? 2 : 3;
}
