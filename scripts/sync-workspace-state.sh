#!/usr/bin/env bash
# ==============================================================================
# Frostfire Cloud: Shadow Worktree State Sync & Snapshot Automation
# Script: scripts/sync-workspace-state.sh
#
# Provides zero-disruption workspace snapshotting, restore, and watch automation
# for ephemeral AWS Lambda Firecracker MicroVMs and agent execution environments.
#
# Invariants:
# 1. Zero disruption to developer/agent working branch (uses Git plumbing & shadow refs)
# 2. Complete capture of staged changes, unstaged changes, and untracked files
# 3. Distributed mutual exclusion via flock on /mnt/workspace/.frostfire/locks/<agent_id>.lock
# 4. Atomic manifest generation with SHA-256 integrity verification
# 5. Graceful SIGTERM/SIGINT flushing for zero data loss during container recycling
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Script Location & Repo Root Discovery
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ------------------------------------------------------------------------------
# Configuration & Defaults
# ------------------------------------------------------------------------------
if [ -n "${FROSTFIRE_PERSIST_ROOT:-}" ]; then
    PERSIST_ROOT="${FROSTFIRE_PERSIST_ROOT}"
elif [ -d "/mnt/workspace" ]; then
    PERSIST_ROOT="/mnt/workspace"
elif [ -n "${WORKSPACE_DIR:-}" ]; then
    PERSIST_ROOT="${WORKSPACE_DIR}"
else
    PERSIST_ROOT="$(pwd)"
fi

DEFAULT_WORKSPACE="${WORKSPACE_DIR:-${PERSIST_ROOT}}"
SYNC_INTERVAL_SECS="${SYNC_INTERVAL_SECS:-15}"
SYNC_VERBOSE="${SYNC_VERBOSE:-0}"
LOCK_TIMEOUT="${LOCK_TIMEOUT:-10}"
LOCK_FD=200

# Directory paths
STATE_BASE="${PERSIST_ROOT}/.frostfire/state"
LOCK_BASE="${PERSIST_ROOT}/.frostfire/locks"

# ------------------------------------------------------------------------------
# Logging Helpers
# ------------------------------------------------------------------------------
log() {
    printf '[sync-workspace-state] %s\n' "$*" >&2
}

vlog() {
    if [ "${SYNC_VERBOSE}" = "1" ] || [ "${SYNC_VERBOSE}" = "true" ]; then
        printf '[sync-workspace-state:debug] %s\n' "$*" >&2
    fi
}

error() {
    printf '[sync-workspace-state:error] %s\n' "$*" >&2
}

# ------------------------------------------------------------------------------
# Validation & Utilities
# ------------------------------------------------------------------------------
validate_agent_id() {
    local agent_id="${1:-}"
    if [ -z "$agent_id" ]; then
        error "agent_id must not be empty"
        return 1
    fi
    # Strict regex matching: alphanumeric, hyphens, underscores, dots only.
    # Rejects path traversal (..), slashes, and command injection characters.
    if [[ ! "$agent_id" =~ ^[a-zA-Z0-9._-]+$ ]]; then
        error "Invalid agent_id '$agent_id': must contain only [a-zA-Z0-9._-] and no path separators or traversal"
        return 1
    fi
    return 0
}

resolve_workspace() {
    local custom_dir="${1:-}"
    local ws_dir
    if [ -n "$custom_dir" ]; then
        ws_dir="$custom_dir"
    elif [ -d "$DEFAULT_WORKSPACE" ]; then
        ws_dir="$DEFAULT_WORKSPACE"
    else
        ws_dir="$(pwd)"
    fi

    if [ ! -d "$ws_dir" ]; then
        mkdir -p "$ws_dir"
    fi
    (cd "$ws_dir" && pwd -P)
}

acquire_lock() {
    local agent_id="$1"
    mkdir -p "$LOCK_BASE"
    local lock_file="${LOCK_BASE}/${agent_id}.lock"

    eval "exec ${LOCK_FD}>\"${lock_file}\""
    if ! flock -x -w "$LOCK_TIMEOUT" "$LOCK_FD"; then
        error "Failed to acquire lock on ${lock_file} within ${LOCK_TIMEOUT}s"
        return 75 # EX_TEMPFAIL
    fi
    vlog "Acquired lock on ${lock_file}"
}

release_lock() {
    flock -u "$LOCK_FD" 2>/dev/null || true
    eval "exec ${LOCK_FD}>&-" 2>/dev/null || true
    vlog "Released lock"
}

is_git_repo() {
    local dir="$1"
    git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# ------------------------------------------------------------------------------
# Subcommand: snapshot
# ------------------------------------------------------------------------------
do_snapshot() {
    local agent_id="$1"
    local ws_arg="${2:-}"
    validate_agent_id "$agent_id" || exit 1

    local ws_dir
    ws_dir="$(resolve_workspace "$ws_arg")"

    acquire_lock "$agent_id"
    local prev_exit_trap
    prev_exit_trap="$(trap -p EXIT || true)"
    trap 'release_lock' EXIT

    local state_dir="${STATE_BASE}/${agent_id}"
    mkdir -p "$state_dir"
    chmod 700 "$state_dir"

    local timestamp_utc
    timestamp_utc="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    local is_git="false"
    local branch=""
    local head_commit=""
    local shadow_commit=""
    local staged_tree=""
    local working_tree=""
    local is_dirty="false"
    local untracked_count=0
    local untracked_file=""
    local untracked_sha256=""
    local archive_file=""
    local archive_sha256=""

    if is_git_repo "$ws_dir"; then
        is_git="true"
        branch="$(git -C "$ws_dir" symbolic-ref --short -q HEAD 2>/dev/null || echo "DETACHED")"
        head_commit="$(git -C "$ws_dir" rev-parse -q --verify HEAD 2>/dev/null || echo "")"

        # Use an isolated temporary index to protect the user's real staging area
        local tmp_index
        tmp_index="$(mktemp "${TMPDIR:-/tmp}/ff_idx_${agent_id}.XXXXXX")"

        # 1. Capture staged tree: seed temp index with real index if it exists
        if [ -f "${ws_dir}/.git/index" ]; then
            cp "${ws_dir}/.git/index" "$tmp_index"
            staged_tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$ws_dir" write-tree 2>/dev/null || echo "")"
        else
            staged_tree=""
        fi

        # 2. Capture working tree: stage all tracked modifications into temp index
        GIT_INDEX_FILE="$tmp_index" git -C "$ws_dir" add -u 2>/dev/null || true
        working_tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$ws_dir" write-tree 2>/dev/null || echo "")"

        # Cleanup isolated index file immediately
        rm -f "$tmp_index"

        # 3. Check for dirty modifications
        if [ -n "$head_commit" ]; then
            local head_tree
            head_tree="$(git -C "$ws_dir" rev-parse -q --verify "${head_commit}^{tree}" 2>/dev/null || echo "")"
            if [ "$working_tree" != "$head_tree" ]; then
                is_dirty="true"
            fi
        elif [ -n "$working_tree" ]; then
            is_dirty="true"
        fi

        # 4. Create shadow commit object under plumbing (does NOT move HEAD or user branch)
        local commit_msg="frostfire-shadow: auto-snapshot [${agent_id}] ${timestamp_utc}"
        if [ -n "$head_commit" ]; then
            shadow_commit="$(git -C "$ws_dir" commit-tree "$working_tree" -p "$head_commit" -m "$commit_msg")"
        elif [ -n "$working_tree" ]; then
            shadow_commit="$(git -C "$ws_dir" commit-tree "$working_tree" -m "$commit_msg")"
        fi

        # 5. Update shadow reference
        if [ -n "$shadow_commit" ]; then
            git -C "$ws_dir" update-ref "refs/frostfire/shadow/${agent_id}" "$shadow_commit"
        fi

        # 6. Archive untracked files safely (excluding .frostfire, .git, and ignored patterns)
        untracked_file="untracked_${shadow_commit:-snapshot}.tar.gz"
        local untracked_tar="${state_dir}/${untracked_file}"

        # Collect untracked files using null delimiters to handle spaces/newlines
        local untracked_list
        untracked_list="$(mktemp "${TMPDIR:-/tmp}/ff_untracked_${agent_id}.XXXXXX")"
        git -C "$ws_dir" ls-files --others --exclude-standard --exclude=".frostfire" --exclude=".frostfire/**" -z 2>/dev/null | \
            grep -zv "^\.frostfire" > "$untracked_list" 2>/dev/null || true

        # Count untracked files
        if [ -s "$untracked_list" ]; then
            untracked_count="$(tr -cd '\0' < "$untracked_list" | wc -c | tr -d ' ')"
            tar -C "$ws_dir" -czf "$untracked_tar" --null -T "$untracked_list" 2>/dev/null
            untracked_sha256="$(sha256sum "$untracked_tar" | cut -d' ' -f1)"
            is_dirty="true"
            # Update latest untracked symlinks/pointers
            ln -sf "$untracked_file" "${state_dir}/untracked.latest.tar.gz" 2>/dev/null || \
                cp -f "$untracked_tar" "${state_dir}/untracked.latest.tar.gz"
            ln -sf "$untracked_file" "${state_dir}/.untracked.tar.gz" 2>/dev/null || \
                cp -f "$untracked_tar" "${state_dir}/.untracked.tar.gz"
            ln -sf "$untracked_file" "${state_dir}/untracked.tar.gz" 2>/dev/null || \
                cp -f "$untracked_tar" "${state_dir}/untracked.tar.gz"
        else
            rm -f "$untracked_tar"
            untracked_file=""
            untracked_count=0
        fi
        rm -f "$untracked_list"

    else
        # Non-Git Workspace fallback: atomic directory tarball
        vlog "Workspace is not a Git repository; taking full tarball snapshot"
        archive_file="workspace_$(date -u +'%Y%m%d_%H%M%S').tar.gz"
        local archive_tar="${state_dir}/${archive_file}"

        tar -C "$ws_dir" --exclude="./.frostfire" --exclude="./.git" -czf "$archive_tar" . 2>/dev/null
        archive_sha256="$(sha256sum "$archive_tar" | cut -d' ' -f1)"
        is_dirty="true"
        ln -sf "$archive_file" "${state_dir}/workspace.latest.tar.gz" 2>/dev/null || \
            cp -f "$archive_tar" "${state_dir}/workspace.latest.tar.gz"
    fi

    # 7. Persist developer CLI credentials if persist-cli-auth exists
    local cli_synced="false"
    if command -v persist-cli-auth >/dev/null 2>&1; then
        persist-cli-auth save >/dev/null 2>&1 || true
        cli_synced="true"
    elif [ -x "/usr/local/bin/persist-cli-auth" ]; then
        /usr/local/bin/persist-cli-auth save >/dev/null 2>&1 || true
        cli_synced="true"
    elif [ -x "${REPO_ROOT}/cloud/microvm/bin/persist-cli-auth" ]; then
        "${REPO_ROOT}/cloud/microvm/bin/persist-cli-auth" save >/dev/null 2>&1 || true
        cli_synced="true"
    elif [ -x "cloud/microvm/bin/persist-cli-auth" ]; then
        cloud/microvm/bin/persist-cli-auth save >/dev/null 2>&1 || true
        cli_synced="true"
    fi

    # 8. Write atomic manifest.json via temporary file and rename
    local manifest_tmp="${state_dir}/manifest.json.tmp.$$"
    cat > "$manifest_tmp" <<EOF
{
  "version": 1,
  "agent_id": "${agent_id}",
  "timestamp_utc": "${timestamp_utc}",
  "workspace_dir": "${ws_dir}",
  "is_git": ${is_git},
  "branch": "${branch}",
  "head_commit": "${head_commit}",
  "shadow_ref": "refs/frostfire/shadow/${agent_id}",
  "shadow_commit": "${shadow_commit}",
  "staged_tree_sha": "${staged_tree}",
  "working_tree_sha": "${working_tree}",
  "dirty": ${is_dirty},
  "untracked_count": ${untracked_count},
  "untracked_file": "${untracked_file}",
  "untracked_sha256": "${untracked_sha256}",
  "archive_file": "${archive_file}",
  "archive_sha256": "${archive_sha256}",
  "cli_auth_synced": ${cli_synced}
}
EOF
    mv -f "$manifest_tmp" "${state_dir}/manifest.json"

    # Retain historical manifest copy indexed by shadow commit or timestamp
    local hist_id="${shadow_commit:-${timestamp_utc//[^0-9]/}}"
    cp -f "${state_dir}/manifest.json" "${state_dir}/manifest_${hist_id}.json"

    release_lock
    if [ -n "$prev_exit_trap" ]; then
        eval "$prev_exit_trap"
    else
        trap - EXIT
    fi

    log "snapshot: agent=${agent_id} commit=${shadow_commit:0:8} dirty=${is_dirty} untracked=${untracked_count}"
}

# ------------------------------------------------------------------------------
# Subcommand: restore
# ------------------------------------------------------------------------------
do_restore() {
    local agent_id="$1"
    local ws_arg="${2:-}"
    validate_agent_id "$agent_id" || exit 1

    local ws_dir
    ws_dir="$(resolve_workspace "$ws_arg")"

    acquire_lock "$agent_id"
    local prev_exit_trap
    prev_exit_trap="$(trap -p EXIT || true)"
    trap 'release_lock' EXIT

    local state_dir="${STATE_BASE}/${agent_id}"
    local manifest="${state_dir}/manifest.json"

    if [ ! -f "$manifest" ]; then
        error "No snapshot manifest found for agent '${agent_id}' at ${manifest}"
        release_lock
        if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
        return 2
    fi

    # Extract manifest fields using python/awk/grep
    local is_git branch head_commit shadow_commit staged_tree working_tree
    local untracked_file untracked_sha256 archive_file archive_sha256

    if command -v python3 >/dev/null 2>&1; then
        read -r is_git branch head_commit shadow_commit staged_tree working_tree untracked_file untracked_sha256 archive_file archive_sha256 < <(
            python3 -c "
import json, sys
m = json.load(open('${manifest}'))
print(f\"{m.get('is_git', False)} {m.get('branch', '')} {m.get('head_commit', '')} {m.get('shadow_commit', '')} {m.get('staged_tree_sha', '')} {m.get('working_tree_sha', '')} {m.get('untracked_file', '')} {m.get('untracked_sha256', '')} {m.get('archive_file', '')} {m.get('archive_sha256', '')}\")
"
        )
    else
        # Fallback minimal regex parser
        is_git="$(grep -o '"is_git": *[a-z]*' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        branch="$(grep -o '"branch": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        head_commit="$(grep -o '"head_commit": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        shadow_commit="$(grep -o '"shadow_commit": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        staged_tree="$(grep -o '"staged_tree_sha": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        working_tree="$(grep -o '"working_tree_sha": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        untracked_file="$(grep -o '"untracked_file": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        untracked_sha256="$(grep -o '"untracked_sha256": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        archive_file="$(grep -o '"archive_file": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
        archive_sha256="$(grep -o '"archive_sha256": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
    fi

    vlog "Manifest parsed: is_git=${is_git} shadow=${shadow_commit:0:8} untracked=${untracked_file}"

    if [ "$is_git" = "True" ] || [ "$is_git" = "true" ]; then
        if ! is_git_repo "$ws_dir"; then
            error "Target workspace ${ws_dir} is not an initialized Git repository"
            release_lock
            if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
            return 3
        fi

        # 1. Verify that shadow commit exists in Git object database
        if [ -n "$shadow_commit" ]; then
            if ! git -C "$ws_dir" cat-file -e "$shadow_commit" 2>/dev/null; then
                error "Shadow commit ${shadow_commit} not found in Git object database"
                release_lock
                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
                return 4
            fi
        fi

        # 2. Restore working tree files non-disruptively (HEAD and branch remain unchanged)
        if [ -n "$working_tree" ]; then
            vlog "Restoring working tree from tree SHA ${working_tree}"
            git -C "$ws_dir" read-tree "$working_tree"
            git -C "$ws_dir" checkout-index -a -f
        fi

        # 3. Restore the staged index so the user's staged changes are faithfully recreated
        if [ -n "$staged_tree" ]; then
            vlog "Restoring staged index from tree SHA ${staged_tree}"
            git -C "$ws_dir" read-tree "$staged_tree"
        elif [ -n "$head_commit" ]; then
            # If nothing was staged relative to HEAD, reset index to HEAD tree
            git -C "$ws_dir" read-tree "$head_commit"
        fi

        # 4. Unpack untracked files archive after validating checksum
        local untracked_archive=""
        if [ -n "$untracked_file" ] && [ -f "${state_dir}/${untracked_file}" ]; then
            untracked_archive="${state_dir}/${untracked_file}"
        elif [ -f "${state_dir}/.untracked.tar.gz" ]; then
            untracked_archive="${state_dir}/.untracked.tar.gz"
        elif [ -f "${state_dir}/untracked.latest.tar.gz" ]; then
            untracked_archive="${state_dir}/untracked.latest.tar.gz"
        elif [ -f "${state_dir}/untracked.tar.gz" ]; then
            untracked_archive="${state_dir}/untracked.tar.gz"
        fi

        if [ -n "$untracked_archive" ] && [ -f "$untracked_archive" ]; then
            local actual_sha256
            actual_sha256="$(sha256sum "$untracked_archive" | cut -d' ' -f1)"
            if [ -n "$untracked_sha256" ] && [ "$actual_sha256" != "$untracked_sha256" ]; then
                error "Checksum mismatch on untracked archive: expected ${untracked_sha256}, got ${actual_sha256}"
                release_lock
                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
                return 5
            fi
            vlog "Extracting untracked files from ${untracked_archive}"
            tar -C "$ws_dir" -xzf "$untracked_archive" 2>/dev/null
        fi

    else
        # Non-Git restore from archive tarball
        local non_git_archive=""
        if [ -n "$archive_file" ] && [ -f "${state_dir}/${archive_file}" ]; then
            non_git_archive="${state_dir}/${archive_file}"
        elif [ -f "${state_dir}/workspace.latest.tar.gz" ]; then
            non_git_archive="${state_dir}/workspace.latest.tar.gz"
        fi

        if [ -n "$non_git_archive" ] && [ -f "$non_git_archive" ]; then
            local actual_archive_sha
            actual_archive_sha="$(sha256sum "$non_git_archive" | cut -d' ' -f1)"
            if [ -n "$archive_sha256" ] && [ "$actual_archive_sha" != "$archive_sha256" ]; then
                error "Checksum mismatch on workspace archive: expected ${archive_sha256}, got ${actual_archive_sha}"
                release_lock
                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
                return 5
            fi
            vlog "Restoring non-git workspace from ${non_git_archive}"
            tar -C "$ws_dir" -xzf "$non_git_archive" 2>/dev/null
        else
            error "Non-git snapshot archive missing at ${state_dir}/${archive_file}"
            release_lock
            if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
            return 6
        fi
    fi

    # 5. Restore developer CLI credentials if available
    if command -v persist-cli-auth >/dev/null 2>&1; then
        persist-cli-auth restore >/dev/null 2>&1 || true
    elif [ -x "/usr/local/bin/persist-cli-auth" ]; then
        /usr/local/bin/persist-cli-auth restore >/dev/null 2>&1 || true
    elif [ -x "${REPO_ROOT}/cloud/microvm/bin/persist-cli-auth" ]; then
        "${REPO_ROOT}/cloud/microvm/bin/persist-cli-auth" restore >/dev/null 2>&1 || true
    elif [ -x "cloud/microvm/bin/persist-cli-auth" ]; then
        cloud/microvm/bin/persist-cli-auth restore >/dev/null 2>&1 || true
    fi

    release_lock
    if [ -n "$prev_exit_trap" ]; then
        eval "$prev_exit_trap"
    else
        trap - EXIT
    fi

    log "restore: agent=${agent_id} completed successfully into ${ws_dir}"
}

# ------------------------------------------------------------------------------
# Subcommand: watch
# ------------------------------------------------------------------------------
do_watch() {
    local agent_id="$1"
    local ws_arg="${2:-}"
    local interval="${3:-$SYNC_INTERVAL_SECS}"
    validate_agent_id "$agent_id" || exit 1

    local ws_dir
    ws_dir="$(resolve_workspace "$ws_arg")"

    log "watch: daemon starting for agent=${agent_id} on ${ws_dir} (interval: ${interval}s)"

    # Graceful shutdown handler on container termination signals
    local shutting_down=0
    handle_shutdown() {
        if [ "$shutting_down" = "1" ]; then
            return
        fi
        shutting_down=1
        log "watch: caught termination signal (SIGTERM/SIGINT) — flushing final dirty snapshot..."
        do_snapshot "$agent_id" "$ws_dir" || true
        log "watch: final flush complete, exiting cleanly"
        exit 0
    }

    trap 'handle_shutdown' SIGTERM SIGINT SIGHUP

    local last_status_hash=""
    while :; do
        if is_git_repo "$ws_dir"; then
            # Fast dirty check: hash the short porcelain status to debounce snapshots
            local current_status_hash
            current_status_hash="$(git -C "$ws_dir" status --porcelain 2>/dev/null | sha256sum | cut -d' ' -f1 || echo "")"
            if [ -n "$current_status_hash" ] && [ "$current_status_hash" != "$last_status_hash" ]; then
                vlog "watch: workspace change detected; executing snapshot"
                do_snapshot "$agent_id" "$ws_dir" || true
                last_status_hash="$current_status_hash"
            else
                vlog "watch: workspace unchanged; skipping snapshot"
            fi
        else
            do_snapshot "$agent_id" "$ws_dir" || true
        fi

        # Interruptible sleep allowing immediate reaction to SIGTERM
        sleep "$interval" &
        wait $! 2>/dev/null || true
    done
}

# ------------------------------------------------------------------------------
# Subcommand: list
# ------------------------------------------------------------------------------
do_list() {
    local json_output="false"
    if [ "${1:-}" = "--json" ]; then
        json_output="true"
    fi

    if [ ! -d "$STATE_BASE" ]; then
        if [ "$json_output" = "true" ]; then
            printf '[]\n'
        else
            log "No snapshots found (directory ${STATE_BASE} does not exist)"
        fi
        return 0
    fi

    if [ "$json_output" = "true" ]; then
        local first=1
        printf '['
        for manifest in "${STATE_BASE}"/*/manifest.json; do
            [ -f "$manifest" ] || continue
            if [ "$first" = 1 ]; then
                first=0
            else
                printf ','
            fi
            cat "$manifest"
        done
        printf ']\n'
    else
        printf '%-20s %-22s %-16s %-10s %-10s %-8s %s\n' \
            "AGENT_ID" "TIMESTAMP (UTC)" "BRANCH" "HEAD" "SHADOW" "DIRTY" "UNTRACKED"
        printf '%s\n' "--------------------------------------------------------------------------------------------------------"

        for manifest in "${STATE_BASE}"/*/manifest.json; do
            [ -f "$manifest" ] || continue
            local aid ts br head sh dirty untracked
            aid="$(grep -o '"agent_id": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
            ts="$(grep -o '"timestamp_utc": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
            br="$(grep -o '"branch": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
            head="$(grep -o '"head_commit": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
            sh="$(grep -o '"shadow_commit": *"[^"]*"' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
            dirty="$(grep -o '"dirty": *[a-z]*' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"
            untracked="$(grep -o '"untracked_count": *[0-9]*' "$manifest" | awk -F: '{print $2}' | tr -d ' "')"

            printf '%-20s %-22s %-16s %-10s %-10s %-8s %s\n' \
                "${aid:0:19}" "${ts:0:21}" "${br:0:15}" "${head:0:8}" "${sh:0:8}" "$dirty" "$untracked"
        done
    fi
}

# ------------------------------------------------------------------------------
# Subcommand: clean
# ------------------------------------------------------------------------------
do_clean() {
    local target="$1"
    local ws_arg="${2:-}"

    if [ "$target" = "--all" ]; then
        log "Purging all snapshot state and locks under ${PERSIST_ROOT}/.frostfire"
        rm -rf "${STATE_BASE}" "${LOCK_BASE}"
        local ws_dir
        ws_dir="$(resolve_workspace "$ws_arg")"
        if is_git_repo "$ws_dir"; then
            for ref in $(git -C "$ws_dir" for-each-ref --format="%(refname)" refs/frostfire/shadow/); do
                git -C "$ws_dir" update-ref -d "$ref" 2>/dev/null || true
            done
        fi
        log "All snapshots and shadow refs cleaned"
        return 0
    fi

    validate_agent_id "$target" || exit 1
    acquire_lock "$target"
    local prev_exit_trap
    prev_exit_trap="$(trap -p EXIT || true)"
    trap 'release_lock' EXIT

    log "Purging snapshot artifacts for agent=${target}"
    rm -rf "${STATE_BASE:?}/${target}"
    rm -f "${LOCK_BASE:?}/${target}.lock"

    local ws_dir
    ws_dir="$(resolve_workspace "$ws_arg")"
    if is_git_repo "$ws_dir"; then
        git -C "$ws_dir" update-ref -d "refs/frostfire/shadow/${target}" 2>/dev/null || true
    fi

    release_lock
    if [ -n "$prev_exit_trap" ]; then
        eval "$prev_exit_trap"
    else
        trap - EXIT
    fi
    log "clean: agent=${target} purged successfully"
}

# ------------------------------------------------------------------------------
# Usage & Main Dispatch
# ------------------------------------------------------------------------------
usage() {
    cat <<EOF
Usage: $(basename "$0") <subcommand> [options]

Subcommands:
  snapshot <agent_id> [workspace_dir]
      Capture staged changes, unstaged changes, and untracked files into
      refs/frostfire/shadow/<agent_id> and write state manifest.

  restore <agent_id> [workspace_dir]
      Rehydrate working copy and untracked artifacts from state manifest
      without altering HEAD or polluting user branches.

  watch <agent_id> [workspace_dir] [interval_secs]
      Run background continuous monitoring daemon; traps SIGTERM/SIGINT
      to flush dirty state before container termination.

  list [--json]
      List all available snapshot manifests and metadata.

  clean <agent_id|--all> [workspace_dir]
      Safely purge state manifests, archives, locks, and shadow refs.

Environment Variables:
  FROSTFIRE_PERSIST_ROOT   Base directory for persistent state (default: /mnt/workspace)
  WORKSPACE_DIR            Default target workspace directory (default: /mnt/workspace)
  SYNC_INTERVAL_SECS       Watcher loop interval in seconds (default: 15)
  SYNC_VERBOSE             Set to 1 or true for verbose diagnostic logs
  LOCK_TIMEOUT             flock acquisition timeout in seconds (default: 10)

EOF
    exit 2
}

main() {
    local cmd="${1:-}"
    shift || true

    case "$cmd" in
        snapshot)
            [ $# -ge 1 ] || usage
            do_snapshot "$@"
            ;;
        restore)
            [ $# -ge 1 ] || usage
            do_restore "$@"
            ;;
        watch)
            [ $# -ge 1 ] || usage
            do_watch "$@"
            ;;
        list)
            do_list "$@"
            ;;
        clean)
            [ $# -ge 1 ] || usage
            do_clean "$@"
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            error "Unknown subcommand '$cmd'"
            usage
            ;;
    esac
}

main "$@"
