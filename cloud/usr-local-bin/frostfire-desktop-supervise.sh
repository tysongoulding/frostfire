# shellcheck shell=bash

# Keep in sync with SAND_SUPERVISOR_DESKTOP_DIR in @anysphere/constants /
# sand-supervisor.mjs.
SAND_DESKTOP_DIR="${SAND_DESKTOP_DIR:-/tmp/sand-desktop}"

# DEFAULT-ON kill-switch: desktop supervision is enabled unless
# SAND_DESKTOP_SUPERVISION_DISABLED is truthy. Mirrors
# isSandDesktopSupervisionEnabled in @anysphere/constants. Returns 0 (enabled) /
# 1 (disabled).
sand_desktop_supervision_enabled() {
	case "$(printf '%s' "${SAND_DESKTOP_SUPERVISION_DISABLED:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
	1 | true | yes) return 1 ;;
	*) return 0 ;;
	esac
}

# Record one supervised desktop component so the supervisor can relaunch it if it
# dies. No-op when supervision is disabled or jq is unavailable (best-effort).
#
# Usage: sand_desktop_register <group> <name> <order> <logFile> <pid> [pidFile] [--listen-port <port>] -- <argv...>
#   <group>    display group: "d1"/"d2"/… or "shared".
#   <name>     component name (also the descriptor/pid file stem): xvfb/x11vnc/…
#   <order>    dependency rank for relaunch ordering (Xvfb 0 → compositor →
#              x11vnc → websockify); a dependency is restarted before its dependents.
#   <logFile>  where a RELAUNCHED instance appends stdout/stderr.
#   <pid>      the pid of the process just launched (from `$!`).
#   [pidFile]  OPTIONAL explicit pid-file path (an arg before `--`). When a script
#              already tracks the process via its own pid file (e.g. the Plank
#              dock in start-desktop.sh), pass it so the supervisor and that script
#              SHARE one pid file — the supervisor's relaunch updates it, so
#              the script's own liveness/re-entry check sees the live pid and never
#              races the supervisor. Defaults to <group>/<name>.pid.
#   --listen-port
#              OPTIONAL TCP listener included in the component's health contract.
#   argv...    the EXACT command (argv[0] resolved on PATH) used to launch it.
# The env the relaunch needs (DISPLAY/HOME/XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS)
# is captured from the current environment; empty values are dropped.
sand_desktop_register() {
	sand_desktop_supervision_enabled || return 0
	command -v jq >/dev/null 2>&1 || return 0
	local group="$1" name="$2" order="$3" logfile="$4" pid="$5"
	shift 5
	local pidfile="" listen_port=""
	if [ "${1:-}" != "--" ] && [ "${1:-}" != "--listen-port" ]; then
		pidfile="$1"
		shift
	fi
	if [ "${1:-}" = "--listen-port" ]; then
		[ "$#" -ge 2 ] || return 0
		listen_port="$2"
		shift 2
		case "${listen_port}" in
		'' | *[!0-9]*) return 0 ;;
		esac
	fi
	[ "${1:-}" = "--" ] && shift
	[ "$#" -ge 1 ] || return 0
	case "${pid}" in
	'' | *[!0-9]*) return 0 ;;
	esac
	local dir="${SAND_DESKTOP_DIR}/${group}"
	mkdir -p "${dir}" 2>/dev/null || return 0
	[ -n "${pidfile}" ] || pidfile="${dir}/${name}.pid"
	# Serialize the argv into a JSON array via a NUL-delimited stream jq slurps.
	# NOT jq's `--args`: that mis-parses any argv token starting with "-" (Xvfb's
	# `-screen`, x11vnc's `-display`/`-rfbport`, websockify flags, …) as a jq
	# option and fails — which would silently write NO descriptor for every real
	# desktop component. NUL-delimiting is robust for leading dashes AND spaces.
	local argv_json
	argv_json="$(printf '%s\0' "$@" | jq -Rs 'split("\u0000")[:-1]' 2>/dev/null)" || return 0
	[ -n "${argv_json}" ] || return 0
	local tmp="${dir}/.${name}.json.$$"
	if jq -n \
		--arg name "${name}" \
		--arg group "${group}" \
		--argjson order "${order}" \
		--arg logfile "${logfile}" \
		--arg pidfile "${pidfile}" \
		--argjson listen_port "${listen_port:-null}" \
		--arg display "${DISPLAY:-}" \
		--arg home "${HOME:-}" \
		--arg xdg "${XDG_RUNTIME_DIR:-}" \
		--arg dbus "${DBUS_SESSION_BUS_ADDRESS:-}" \
		--argjson argv "${argv_json}" \
		'({name: $name, group: $group, order: $order, logFile: $logfile, pidFile: $pidfile,
		  env: ({DISPLAY: $display, HOME: $home, XDG_RUNTIME_DIR: $xdg, DBUS_SESSION_BUS_ADDRESS: $dbus}
		        | with_entries(select(.value != ""))),
		  argv: $argv}
		  + if $listen_port == null then {} else {listenPort: $listen_port} end)' >"${tmp}" 2>/dev/null; then
		mv -f "${tmp}" "${dir}/${name}.json" 2>/dev/null || rm -f "${tmp}"
		printf '%s' "${pid}" >"${pidfile}" 2>/dev/null || true
	else
		rm -f "${tmp}" 2>/dev/null || true
	fi
}

# Stop supervising every component in a display group (used by stop-window.sh when
# a forked desktop is torn down). Remove the descriptors FIRST, then the caller
# kills the processes, so the supervisor never relaunches a component that is on
# its way down (no restart storm on a stopped fork). Safe when the dir is absent.
sand_desktop_unregister_group() {
	local group="$1"
	[ -n "${group}" ] || return 0
	rm -rf "${SAND_DESKTOP_DIR:?}/${group}" 2>/dev/null || true
}
