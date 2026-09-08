#!/usr/bin/env bash
# shellcheck shell=bash

# ==============================================================================
# box-cgroups.sh: Cgroups v2 Dual-Domain Partitioning
# Part of Frostfire Cloud MicroVM Virtualization Infrastructure (Milestone 2 - Feature F7)
# ==============================================================================

SAND_CGROUP_ROOT="${SAND_CGROUP_ROOT:-/sys/fs/cgroup}"
SAND_CGROUP_INTERACTIVE_NAME="interactive"
SAND_CGROUP_AGENT_NAME="agent"
SAND_CGROUP_INTERACTIVE_WEIGHT="${SAND_CGROUP_INTERACTIVE_WEIGHT:-800}"
SAND_CGROUP_AGENT_WEIGHT="${SAND_CGROUP_AGENT_WEIGHT:-100}"
SAND_CGROUP_INTERACTIVE_MEMORY_HIGH="${SAND_CGROUP_INTERACTIVE_MEMORY_HIGH:-4G}"
SAND_CGROUP_INTERACTIVE_MEMORY_MAX="${SAND_CGROUP_INTERACTIVE_MEMORY_MAX:-6G}"
SAND_CGROUP_AGENT_MEMORY_HIGH="${SAND_CGROUP_AGENT_MEMORY_HIGH:-10G}"
SAND_CGROUP_AGENT_MEMORY_MAX="${SAND_CGROUP_AGENT_MEMORY_MAX:-12G}"

sand_cgroups_enabled() {
	case "$(printf '%s' "${SAND_BOX_CGROUPS_DISABLED:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
	1 | true | yes) return 1 ;;
	*) return 0 ;;
	esac
}

sand_cgroup_log() {
	echo "[box-cgroups] $*" >&2
}

sand_cgroup_write() {
	local value="$1" path="$2"
	printf '%s' "${value}" >"${path}" 2>/dev/null || return 1
	return 0
}

sand_cgroup_v2_cpu_available() {
	local controllers="${SAND_CGROUP_ROOT}/cgroup.controllers"
	[ -r "${controllers}" ] || return 1
	grep -qw cpu "${controllers}" 2>/dev/null || return 1
	return 0
}

sand_cgroup_is_threaded() {
	local type_file="${SAND_CGROUP_ROOT}/cgroup.type"
	[ -r "${type_file}" ] || return 1
	case "$(cat "${type_file}" 2>/dev/null)" in
	threaded) return 0 ;;
	*) return 1 ;;
	esac
}

sand_cgroup_sanitize_group() {
	local group="$1"
	case "${group}" in
	*..* | /* | "") return 1 ;;
	*) return 0 ;;
	esac
}

sand_cgroup_migrate_root_procs() {
	local group="$1"
	sand_cgroup_sanitize_group "${group}" || return 0
	local dest="${SAND_CGROUP_ROOT}/${group}/cgroup.procs"
	local src="${SAND_CGROUP_ROOT}/cgroup.procs"
	[ -r "${src}" ] || return 0
	[ -d "${SAND_CGROUP_ROOT}/${group}" ] || return 0

	local pid pids
	pids="$(cat "${src}" 2>/dev/null || true)"
	for pid in ${pids}; do
		case "${pid}" in
		'' | *[!0-9]*) continue ;;
		esac
		printf '%s\n' "${pid}" >"${dest}" 2>/dev/null || true
	done
	return 0
}

sand_cgroup_apply_weight() {
	local group="$1" weight="$2"
	sand_cgroup_sanitize_group "${group}" || return 0
	[ -n "${weight}" ] || return 0

	case "${weight}" in
	'' | *[!0-9]*)
		sand_cgroup_log "ignoring non-numeric cpu.weight '${weight}' for ${group}"
		return 0
		;;
	esac

	if [ "${weight}" -lt 1 ] || [ "${weight}" -gt 10000 ]; then
		sand_cgroup_log "ignoring out-of-range cpu.weight ${weight} for ${group} (allowed: 1..10000)"
		return 0
	fi

	if sand_cgroup_write "${weight}" "${SAND_CGROUP_ROOT}/${group}/cpu.weight"; then
		sand_cgroup_log "${group}: cpu.weight=${weight}"
	fi
	return 0
}

parse_bytes() {
	local val="$1"
	case "${val}" in
	*G | *g) echo "$(( ${val%[Gg]} * 1024 * 1024 * 1024 ))" ;;
	*M | *m) echo "$(( ${val%[Mm]} * 1024 * 1024 ))" ;;
	*K | *k) echo "$(( ${val%[Kk]} * 1024 ))" ;;
	*) echo "${val}" ;;
	esac
}

sand_cgroup_configure_memory_and_swap() {
	local group="$1" high="$2" max="$3"
	sand_cgroup_sanitize_group "${group}" || return 0
	local target_dir="${SAND_CGROUP_ROOT}/${group}"
	[ -d "${target_dir}" ] || return 0

	# 1. Disable swap for domain (matches SWAP_SIZE_MB=0 microVM kernel flag)
	if [ -w "${target_dir}/memory.swap.max" ]; then
		sand_cgroup_write "0" "${target_dir}/memory.swap.max" || true
		sand_cgroup_log "${group}: swap disabled (memory.swap.max=0)"
	fi

	# 2. Configure memory throttle boundaries
	if [ -n "${high}" ] && [ -n "${max}" ]; then
		local high_b max_b
		high_b="$(parse_bytes "${high}")"
		max_b="$(parse_bytes "${max}")"
		if [ "${high_b}" -lt "${max_b}" ] 2>/dev/null; then
			sand_cgroup_write "${high}" "${target_dir}/memory.high" || true
			sand_cgroup_write "${max}" "${target_dir}/memory.max" || true
			sand_cgroup_log "${group}: memory.high=${high}, memory.max=${max}"
		else
			sand_cgroup_log "ignoring invalid memory limits: memory.high (${high}) must be strictly less than memory.max (${max})"
		fi
	elif [ -n "${max}" ]; then
		sand_cgroup_write "${max}" "${target_dir}/memory.max" || true
	fi
	return 0
}

sand_cgroup_setup() {
	sand_cgroups_enabled || {
		sand_cgroup_log "disabled by SAND_BOX_CGROUPS_DISABLED; skipping"
		return 0
	}

	if ! sand_cgroup_v2_cpu_available; then
		sand_cgroup_log "no cgroup v2 cpu controller at ${SAND_CGROUP_ROOT}; skipping"
		return 0
	fi

	if sand_cgroup_is_threaded; then
		sand_cgroup_log "cgroup at ${SAND_CGROUP_ROOT} is threaded; skipping"
		return 0
	fi

	# Verify invariant: interactive_weight >= agent_weight * 8
	if [ "${SAND_CGROUP_INTERACTIVE_WEIGHT}" -lt "$((SAND_CGROUP_AGENT_WEIGHT * 8))" ]; then
		sand_cgroup_log "WARNING: interactive weight (${SAND_CGROUP_INTERACTIVE_WEIGHT}) is less than 8x agent weight (${SAND_CGROUP_AGENT_WEIGHT})"
	fi

	local group
	for group in "${SAND_CGROUP_INTERACTIVE_NAME}" "${SAND_CGROUP_AGENT_NAME}"; do
		if ! mkdir -p "${SAND_CGROUP_ROOT}/${group}" 2>/dev/null; then
			sand_cgroup_log "cannot create ${SAND_CGROUP_ROOT}/${group}; skipping"
			return 0
		fi
	done

	# Satisfy "no internal processes" rule before activating subtree controllers
	sand_cgroup_migrate_root_procs "${SAND_CGROUP_AGENT_NAME}"

	# Enable controllers in root subtree
	sand_cgroup_write "+cpu" "${SAND_CGROUP_ROOT}/cgroup.subtree_control" || true
	sand_cgroup_write "+memory" "${SAND_CGROUP_ROOT}/cgroup.subtree_control" 2>/dev/null || true

	# Apply weights
	sand_cgroup_apply_weight "${SAND_CGROUP_INTERACTIVE_NAME}" "${SAND_CGROUP_INTERACTIVE_WEIGHT}"
	sand_cgroup_apply_weight "${SAND_CGROUP_AGENT_NAME}" "${SAND_CGROUP_AGENT_WEIGHT}"

	# Configure memory & swap
	sand_cgroup_configure_memory_and_swap "${SAND_CGROUP_INTERACTIVE_NAME}" "${SAND_CGROUP_INTERACTIVE_MEMORY_HIGH}" "${SAND_CGROUP_INTERACTIVE_MEMORY_MAX}"
	sand_cgroup_configure_memory_and_swap "${SAND_CGROUP_AGENT_NAME}" "${SAND_CGROUP_AGENT_MEMORY_HIGH}" "${SAND_CGROUP_AGENT_MEMORY_MAX}"

	sand_cgroup_log "cgroup v2 partitioned: interactive (${SAND_CGROUP_INTERACTIVE_WEIGHT}) vs agent (${SAND_CGROUP_AGENT_WEIGHT})"
	return 0
}

sand_cgroup_place() {
	local group="$1" pid="$2"
	sand_cgroups_enabled || return 0
	sand_cgroup_sanitize_group "${group}" || return 0

	case "${pid}" in
	'' | *[!0-9]*) return 0 ;;
	esac

	[ -d "${SAND_CGROUP_ROOT}/${group}" ] || return 0
	{ printf '%s\n' "${pid}" >"${SAND_CGROUP_ROOT}/${group}/cgroup.procs"; } 2>/dev/null || true
	return 0
}

sand_cgroup_join() {
	local group="$1"
	sand_cgroup_place "${group}" "$$"
	return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	sand_cgroup_setup
fi
