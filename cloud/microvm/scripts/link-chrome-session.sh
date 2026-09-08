#!/usr/bin/env bash
# Link session SQLite databases (Cookies, Login Data, Login Data For Account) across multi-display Chrome profiles.
# Implements "One microVM, one authenticated session" across all concurrent agent screens.

set -euo pipefail

PROFILE_DIR="${1:-}"
SESSION_DIR="${CHROME_SESSION_DIR:-/home/box/chrome-profile/Default}"

if [ -z "${PROFILE_DIR}" ]; then
  exit 0
fi

# Normalize PROFILE_DIR: if caller passed path ending in /Default, strip it
if [[ "${PROFILE_DIR}" == */Default ]]; then
  DEFAULT_DIR="${PROFILE_DIR}"
  PROFILE_DIR="${PROFILE_DIR%/Default}"
else
  DEFAULT_DIR="${PROFILE_DIR}/Default"
fi

ensure_secure_dir() {
  local dir="$1"
  mkdir -p "${dir}" 2>/dev/null || true
  chmod 700 "${dir}" 2>/dev/null || true
  if [ "$(id -u)" -eq 0 ] && id "box" >/dev/null 2>&1; then
    chown box:box "${dir}" 2>/dev/null || true
  fi
}

ensure_secure_dir "${SESSION_DIR}"

# Prevent circular symlink and destruction of master profile databases
CANONICAL_TARGET="$(readlink -f "${SESSION_DIR}" 2>/dev/null || echo "${SESSION_DIR}")"
CANONICAL_DEST="$(readlink -f "${DEFAULT_DIR}" 2>/dev/null || echo "${DEFAULT_DIR}")"
if [ "${CANONICAL_TARGET}" = "${CANONICAL_DEST}" ]; then
  exit 0
fi

if [ -L "${DEFAULT_DIR}" ]; then
  rm -f "${DEFAULT_DIR}" 2>/dev/null || true
fi
ensure_secure_dir "${DEFAULT_DIR}"

SESSION_FILES=(Cookies "Login Data" "Login Data For Account")
for name in "${SESSION_FILES[@]}"; do
  target="${SESSION_DIR}/${name}"
  link="${DEFAULT_DIR}/${name}"

  # Clean up any stale local SQLite journal/WAL lock files in target display directory
  # that could cause SQLITE_BUSY or rollback concurrency conflicts
  rm -f "${link}-journal" "${link}-wal" "${link}-shm" 2>/dev/null || true

  # Ensure master database file exists so symlink is valid
  if [ ! -e "${target}" ] && [ ! -L "${target}" ]; then
    touch "${target}" 2>/dev/null || true
    chmod 600 "${target}" 2>/dev/null || true
    if [ "$(id -u)" -eq 0 ] && id "box" >/dev/null 2>&1; then
      chown box:box "${target}" 2>/dev/null || true
    fi
  fi

  # Already correctly symlinked: leave untouched
  if [ -L "${link}" ] && [ "$(readlink "${link}" 2>/dev/null)" = "${target}" ]; then
    continue
  fi

  # Safely replace with symlink
  rm -f "${link}" 2>/dev/null || true
  ln -s "${target}" "${link}" 2>/dev/null || true
done

exit 0
