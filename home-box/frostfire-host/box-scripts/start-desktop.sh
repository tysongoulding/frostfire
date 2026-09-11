#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
export HOME="${HOME:-/home/box}"
export XDG_RUNTIME_DIR="${SAND_XDG_RUNTIME_DIR:-${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}}"
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}" || true

if [ -r /usr/local/bin/sand-desktop-supervise.sh ]; then
	# shellcheck source=/dev/null
	. /usr/local/bin/sand-desktop-supervise.sh
fi
if ! command -v sand_desktop_register >/dev/null 2>&1; then
	sand_desktop_register() { :; }
fi

SAND_BOX_CGROUPS_LIB="${SAND_BOX_CGROUPS_LIB:-/usr/local/bin/box-cgroups.sh}"
if [ -r "${SAND_BOX_CGROUPS_LIB}" ]; then
	# shellcheck source=/dev/null
	. "${SAND_BOX_CGROUPS_LIB}"
fi
if ! command -v sand_cgroup_join >/dev/null 2>&1; then
	sand_cgroup_join() { :; }
fi
sand_cgroup_join "${SAND_CGROUP_INTERACTIVE_NAME:-interactive}"

SAND_DESKTOP_NUM="${DISPLAY#:}"
SAND_DESKTOP_NUM="${SAND_DESKTOP_NUM%%.*}"
SAND_DESKTOP_GROUP="d${SAND_DESKTOP_NUM:-1}"

/usr/local/bin/ensure-machine-id || true

SCREEN_WIDTH=1280
SCREEN_HEIGHT=800

# >>> box port table (from sand/src/shared/box/box-contract.ts; regenerate: pnpm --filter sand run gen:box-ports) >>>
SAND_BOX_PORT_HOST_GATEWAY=1340
SAND_BOX_NOVNC_TOKEN_DIR="/tmp/sand-novnc-tokens.d"
VNC_PORT="${SAND_VNC_PORT:-5900}"
NOVNC_PORT="${SAND_NOVNC_PORT:-6080}"
# <<< box port table <<<
# An idle desktop produces no RFB framebuffer traffic, so without a ping the
# socket is completely silent and the anyrun authed public LB (and any NAT /
# proxy hop) eventually drops the idle connection — which surfaced as the viewer
# intermittently flipping to "Reconnecting" during quiet stretches. 30s stays
# well under a 60s ALB idle timeout while costing one tiny frame per interval.
NOVNC_HEARTBEAT_S="${SAND_NOVNC_HEARTBEAT_S:-30}"

if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
	eval "$(dbus-launch --sh-syntax)"
fi

BOX_DISPLAY_NUM="${DISPLAY#:}"
BOX_DISPLAY_NUM="${BOX_DISPLAY_NUM%%.*}"
if [ "${BOX_DISPLAY_NUM:-1}" -ge 2 ] 2>/dev/null; then
	BOX_USER_XDG_DIR="/tmp/xdg-runtime-box-${BOX_DISPLAY_NUM}"
else
	BOX_USER_XDG_DIR="/tmp/xdg-runtime-box"
fi
if [ "$(id -u)" -eq 0 ]; then
	install -d -o box -g box -m 700 "${BOX_USER_XDG_DIR}" 2>/dev/null || true
	rm -f "${BOX_USER_XDG_DIR}/dbus-session-address"
	BOX_DBUS_ADDRESS="$(runuser -u box -- env \
		XDG_RUNTIME_DIR="${BOX_USER_XDG_DIR}" DISPLAY="${DISPLAY}" HOME=/home/box \
		dbus-launch --sh-syntax 2>/dev/null \
		| sed -n "s/^DBUS_SESSION_BUS_ADDRESS='\(.*\)';/\1/p")"
	if [ -n "${BOX_DBUS_ADDRESS}" ]; then
		printf '%s' "${BOX_DBUS_ADDRESS}" >"${BOX_USER_XDG_DIR}/dbus-session-address"
		chown box:box "${BOX_USER_XDG_DIR}/dbus-session-address" 2>/dev/null || true
	fi
else
	mkdir -p "${BOX_USER_XDG_DIR}" 2>/dev/null || true
	chmod 700 "${BOX_USER_XDG_DIR}" 2>/dev/null || true
	printf '%s' "${DBUS_SESSION_BUS_ADDRESS:-}" >"${BOX_USER_XDG_DIR}/dbus-session-address" 2>/dev/null || true
fi

if [ -n "${SAND_GATEWAY_TOKEN:-}" ]; then
	mkdir -p "${BOX_USER_XDG_DIR}" 2>/dev/null || true
	printf '%s\n%s\n' "${SAND_GATEWAY_TOKEN}" "${SAND_HOST_PORT:-${SAND_BOX_PORT_HOST_GATEWAY}}" \
		>"${BOX_USER_XDG_DIR}/sand-gateway-credential" 2>/dev/null || true
	chmod 600 "${BOX_USER_XDG_DIR}/sand-gateway-credential" 2>/dev/null || true
fi

/usr/local/bin/box-bounded-log --run "/tmp/xvfb${DISPLAY}.log" -- \
	/usr/local/bin/box-xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24" -ac +extension GLX +render -noreset &
sand_desktop_register "${SAND_DESKTOP_GROUP}" xvfb 0 "/tmp/xvfb${DISPLAY}.log" "$!" -- \
	/usr/local/bin/box-bounded-log --run "/tmp/xvfb${DISPLAY}.log" -- \
	/usr/local/bin/box-xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24" -ac +extension GLX +render -noreset

DISPLAY_READY=false
for _ in $(seq 1 100); do
	if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
		DISPLAY_READY=true
		break
	fi
	sleep 0.2
done

if [ "${DISPLAY_READY}" != "true" ]; then
	echo "X display did not become ready" >&2
	exit 1
fi

# Paint the framebuffer before x11vnc can expose it. Fresh Xvfb starts black,
# and an initial black RFB frame can otherwise remain cached when XDamage misses
# a later composited repaint.
if [ -x /usr/local/bin/sand-wallpaper ]; then
	/usr/local/bin/sand-wallpaper paint || true
else
	hsetroot -cover /usr/share/backgrounds/cursor-box-wallpaper.jpg \
		|| hsetroot -solid "#1e2330" \
		|| xsetroot -solid "#1e2330" \
		|| true
fi

X11VNC_ARGS=(
	-display "${DISPLAY}"
	-localhost
	-nopw
	-shared
	-forever
	# XDamage is only an optimization here: under Xvfb + picom it can miss a
	# composited repaint and leave noVNC stale. Polling the full 1280x800
	# framebuffer is reliable and inexpensive because Xvfb stores it in RAM.
	-noxdamage
	-rfbport "${VNC_PORT}"
	-quiet
)
/usr/local/bin/box-bounded-log --run "/tmp/x11vnc${DISPLAY}.log" -- \
	/usr/local/bin/box-x11vnc "${X11VNC_ARGS[@]}" &
sand_desktop_register "${SAND_DESKTOP_GROUP}" x11vnc 3 "/tmp/x11vnc${DISPLAY}.log" "$!" -- \
	/usr/local/bin/box-bounded-log --run "/tmp/x11vnc${DISPLAY}.log" -- \
	/usr/local/bin/box-x11vnc "${X11VNC_ARGS[@]}"

if [ -n "${SAND_NOVNC_TOKEN:-}" ]; then
	TOKEN_DIR="${SAND_NOVNC_TOKEN_DIR:-${SAND_BOX_NOVNC_TOKEN_DIR}}"
	mkdir -p "${TOKEN_DIR}"
	printf '%s: localhost:%s\n' "${SAND_NOVNC_TOKEN}" "${VNC_PORT}" \
		>"${TOKEN_DIR}/${SAND_NOVNC_TOKEN}"
else
	WEBSOCKIFY_ARGS=(
		--web=/usr/share/novnc
		--heartbeat="${NOVNC_HEARTBEAT_S}"
		"0.0.0.0:${NOVNC_PORT}"
		"localhost:${VNC_PORT}"
	)
	/usr/local/bin/box-bounded-log --run "/tmp/novnc${DISPLAY}.log" -- \
		websockify "${WEBSOCKIFY_ARGS[@]}" &
	sand_desktop_register "${SAND_DESKTOP_GROUP}" websockify 4 "/tmp/novnc${DISPLAY}.log" "$!" -- \
		/usr/local/bin/box-bounded-log --run "/tmp/novnc${DISPLAY}.log" -- \
		websockify "${WEBSOCKIFY_ARGS[@]}"
fi

# Window manager: gives every window a title bar (close / minimise / maximise)
# and drag. Compositing is handled by picom below — xfwm4's own compositor
# grabs the composite overlay without advertising _NET_WM_CM_S0 under Xvfb,
# which leaves Plank rendering an opaque fallback. Route both initial launch and
# supervisor replay through box-xfwm4 so an untracked same-display owner cannot
# leave every replacement exiting with "Another Window Manager ... is already
# running". The launcher execs xfwm4, preserving the tracked pid.
/usr/local/bin/box-bounded-log --run "/tmp/xfwm4${DISPLAY}.log" -- \
	/usr/local/bin/box-xfwm4 --compositor=off &
sand_desktop_register "${SAND_DESKTOP_GROUP}" xfwm4 1 "/tmp/xfwm4${DISPLAY}.log" "$!" -- \
	/usr/local/bin/box-bounded-log --run "/tmp/xfwm4${DISPLAY}.log" -- \
	/usr/local/bin/box-xfwm4 --compositor=off

for _ in $(seq 1 50); do
	if xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1; then
		break
	fi
	sleep 0.2
done

# Compositor flags, tuned for the box's GPU-less virtual display (SAND-161):
#  - xrender: the only backend that works without a GPU (Xvfb has no GL device;
#    picom's glx/egl backends abort at init here).
#  - no-vsync + no-frame-pacing: both lean on Present/vblank timing, which a
#    virtual framebuffer doesn't provide (Xvfb's RandR reports no refresh rate);
#    picom disables frame pacing itself when vsync is off, so pinning BOTH off
#    makes the no-vblank path explicit instead of implied.
#  - no-use-damage: repaint the whole (1280x800) screen instead of tracking
#    damaged regions. Stale damage accounting is exactly the reported corruption
#    class — chunks of the root wallpaper painted over Chrome content — and a
#    full repaint per frame is cheap at this size while making it structurally
#    impossible for a region to stay unrepainted.
PICOM_ARGS=(
	--backend xrender
	--no-vsync
	--no-frame-pacing
	--no-use-damage
)
/usr/local/bin/box-bounded-log --run "/tmp/picom${DISPLAY}.log" -- \
	/usr/local/bin/box-picom "${PICOM_ARGS[@]}" &
sand_desktop_register "${SAND_DESKTOP_GROUP}" picom 2 "/tmp/picom${DISPLAY}.log" "$!" -- \
	/usr/local/bin/box-bounded-log --run "/tmp/picom${DISPLAY}.log" -- \
	/usr/local/bin/box-picom "${PICOM_ARGS[@]}"

# No --test-type / --enable-automation:
# those are automation tells anti-bot vendors (Akamai etc.) score against, and we
# drive the browser at the OS level (xdotool) rather than over CDP, so we don't
# need them. --no-sandbox is required because anyrun runs the box in a firecracker
# microVM whose guest kernel forbids the user/PID-namespace (and setuid) sandbox
# Chrome needs: without it the browser aborts on startup ("Failed to move to new
# namespace ... Operation not permitted"), so every on-demand launch (a dock click
# or the agent running box-chrome) would die silently (a separate bug this same
# wrapper fixes). (DockerSandBox dodged it only because it runs the container
# seccomp=unconfined; the firecracker box has no such opt-out.)
# It is a process-level flag, not web-visible like --test-type, so it adds no
# anti-bot signal, and Chrome runs as the non-root box user either way (this
# whole desktop runs as box; the runuser branch below covers a root caller).
# The GPU flags are deliberate: --disable-gpu is absent (it would kill
# WebGPU) and --enable-unsafe-webgpu exposes a software (SwiftShader) adapter with
# no real GPU. Because that adapter is software, a GPU-heavy page burns a whole
# core inside the gpu-process, which on the box's small core count starves the
# in-box host (message-loading, agent turns). The gpu-process is zygote-forked, so
# a --gpu-launcher prefix never wraps it; instead the whole browser is launched
# under `nice` below and every child (the zygote, and the renderers + gpu-process
# it forks) inherits the low priority, so a runaway page yields the CPU to the host
# instead of pinning a core. --password-store=basic avoids a hang on the missing
# system keyring;
cat >/usr/local/bin/box-chrome <<'EOF'
#!/usr/bin/env bash
# >>> box-chrome port table (from sand/src/shared/box/box-contract.ts; regenerate: pnpm --filter sand run gen:box-ports) >>>
SAND_BOX_CDP_PORT_BASE=9222
SAND_BOX_PORT_HOST_GATEWAY=1340
# <<< box-chrome port table <<<
/usr/local/bin/ensure-machine-id || true

if [ -r /usr/local/bin/box-cgroups.sh ]; then
	# shellcheck source=/dev/null
	. /usr/local/bin/box-cgroups.sh
	sand_cgroup_join "${SAND_CGROUP_INTERACTIVE_NAME:-interactive}"
fi

BOX_DISPLAY_NUM="${DISPLAY#:}"
BOX_DISPLAY_NUM="${BOX_DISPLAY_NUM%%.*}"
BOX_PRIMARY_XDG="/tmp/xdg-runtime-box"
if [ "${BOX_DISPLAY_NUM:-1}" -ge 2 ] 2>/dev/null; then
	CHROME_PROFILE="${CHROME_USER_DATA_DIR:-/home/box/chrome-profile-${BOX_DISPLAY_NUM}}"
	CHROME_XDG="/tmp/xdg-runtime-box-${BOX_DISPLAY_NUM}"
	CHROME_DEBUG_PORT="${SAND_CHROME_REMOTE_DEBUG_PORT:-$((SAND_BOX_CDP_PORT_BASE + BOX_DISPLAY_NUM))}"
	if [ -z "${CHROME_USER_DATA_DIR:-}" ]; then
		SAND_CHROME_PROFILE_DIR="${CHROME_PROFILE}" /usr/local/bin/link-chrome-session || true
	fi
else
	CHROME_PROFILE="${CHROME_USER_DATA_DIR:-/home/box/chrome-profile}"
	CHROME_XDG="${BOX_PRIMARY_XDG}"
	CHROME_DEBUG_PORT="${SAND_CHROME_REMOTE_DEBUG_PORT:-$((SAND_BOX_CDP_PORT_BASE + 1))}"
fi
CHROME_DBUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}"
if [ "$(id -u)" -eq 0 ]; then
	CHROME_DBUS_ADDRESS=""
fi
if [ -r "${CHROME_XDG}/dbus-session-address" ]; then
	CHROME_DBUS_ADDRESS="$(cat "${CHROME_XDG}/dbus-session-address" 2>/dev/null || true)"
fi
CHROME_FLAGS=(
	--no-sandbox
	--disable-dev-shm-usage
	--password-store=basic
	--no-first-run
	--no-default-browser-check
	--hide-crash-restore-bubble
	--start-maximized
	--class=box-chrome
	--user-data-dir="${CHROME_PROFILE}"
)
# WebGL on this GPU-less Xvfb box. Default --enable-unsafe-swiftshader keeps a
# software context and prints ANGLE(... SwiftShader Device (Subzero) ...).
# sand_enable_spoof_gpu writes /tmp/sand-enable-spoof-gpu (or set
# SAND_ENABLE_SPOOF_GPU=1) so we launch with --use-angle=gl instead: no WebGL
# context, and no SwiftShader renderer string. SAND_CHROME_LEGACY_GPU=1
# restores blocklist-ignore + software WebGPU. Chrome must restart to pick up
# a marker flip.
if [ "${SAND_CHROME_LEGACY_GPU:-0}" = "1" ]; then
	CHROME_FLAGS+=(
		--ignore-gpu-blocklist
		--enable-unsafe-webgpu
	)
elif [ "${SAND_ENABLE_SPOOF_GPU:-0}" = "1" ] || [ -e "${SAND_ENABLE_SPOOF_GPU_FILE:-/tmp/sand-enable-spoof-gpu}" ]; then
	CHROME_FLAGS+=(
		--use-angle=gl
	)
else
	CHROME_FLAGS+=(
		--enable-unsafe-swiftshader
	)
fi
CHROME_FLAGS+=(
	--remote-debugging-port="${CHROME_DEBUG_PORT}"
	--remote-debugging-address=127.0.0.1
)
SAND_CHROME_UA_TOKEN="GrokAgent/1.0"
SAND_CHROME_UA_OWNER_FILE="${SAND_CHROME_UA_OWNER_FILE:-/tmp/sand-ua-user}"
SAND_CHROME_UA_OWNER="$(sed -n 1p "${SAND_CHROME_UA_OWNER_FILE}" 2>/dev/null | tr -cd '0-9a-f' | cut -c1-16 || true)"
[ -z "${SAND_CHROME_UA_OWNER}" ] || SAND_CHROME_UA_TOKEN="${SAND_CHROME_UA_TOKEN} (u:${SAND_CHROME_UA_OWNER})"
SAND_CHROME_UA_DISABLED_FILE="${SAND_CHROME_UA_DISABLED_FILE:-/tmp/sand-ua-token-disabled}"
[ ! -e "${SAND_CHROME_UA_DISABLED_FILE}" ] || SAND_CHROME_UA_TOKEN=""
SAND_CHROME_UA_MAJOR="$(google-chrome-stable --version 2>/dev/null | sed -n 's/^[^0-9]*\([0-9][0-9]*\)\..*$/\1/p' || true)"
if [ -n "${SAND_CHROME_UA_MAJOR}" ] && [ -n "${SAND_CHROME_UA_TOKEN}" ]; then
	CHROME_FLAGS+=(
		--user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${SAND_CHROME_UA_MAJOR}.0.0.0 Safari/537.36 ${SAND_CHROME_UA_TOKEN}"
	)
fi
SAND_EGRESS_PROXY_FILE=/tmp/sand-egress-proxy
if [ -r "${SAND_EGRESS_PROXY_FILE}" ]; then
	SAND_EGRESS_PROXY_ADDR="$(sed -n 1p "${SAND_EGRESS_PROXY_FILE}" 2>/dev/null || true)"
	if [ -n "${SAND_EGRESS_PROXY_ADDR}" ]; then
		CHROME_FLAGS+=(
			--proxy-server="http://${SAND_EGRESS_PROXY_ADDR}"
			--proxy-bypass-list="localhost;127.0.0.1;[::1]"
		)
	fi
fi
# Installed by POLICY, not --load-extension: this Chrome is managed (a policy
# file exists), and managed Chrome silently ignores that switch. The entry is
# written per launch rather than baked into the image so the proxy stays
# opt-in — an always-installed extension would attach and then fail EVERY
# ceremony on a box with no laptop provider, which is worse than not having it.
/usr/local/bin/box-chrome-policy || true
SAND_WEBAUTHN_ID_FILE=/usr/local/share/sand-webauthn-proxy.id
SAND_WEBAUTHN_MARKER=/home/box/.sand-webauthn-proxy-enabled
CHROME_LOG="/tmp/chrome${DISPLAY:-:1}.log"
SAND_CHROME_PREPARE=0
if [ "${1:-}" = "--sand-prepare" ]; then
	SAND_CHROME_PREPARE=1
	shift
fi
if [ "$(id -u)" -eq 0 ]; then
	mkdir -p "${CHROME_PROFILE}" "${CHROME_XDG}" /workspace
	chown box:box "${CHROME_PROFILE}" 2>/dev/null || true
	chown -R box:box "${CHROME_XDG}" 2>/dev/null || true
else
	mkdir -p "${CHROME_PROFILE}" "${CHROME_XDG}" 2>/dev/null || true
fi
chmod 700 "${CHROME_PROFILE}" "${CHROME_XDG}" 2>/dev/null || true
SAND_CHROME_TZ_HELPER="${SAND_CHROME_TZ_HELPER:-/usr/local/bin/sand-wallpaper}"
if [ "${SAND_CHROME_USER_TZ:-}" = "1" ] && [ -z "${SAND_CHROME_TZ:-}" ] && [ -x "${SAND_CHROME_TZ_HELPER}" ]; then
	SAND_CHROME_TZ="$("${SAND_CHROME_TZ_HELPER}" zone 2>/dev/null || true)"
fi
CHROME_ENV=(
	env
	DISPLAY="${DISPLAY:-:1}"
	HOME=/home/box
	TZ="${SAND_CHROME_TZ:-America/Los_Angeles}"
	XDG_RUNTIME_DIR="${CHROME_XDG}"
	DBUS_SESSION_BUS_ADDRESS="${CHROME_DBUS_ADDRESS}"
)
if [ -f "${SAND_WEBAUTHN_MARKER}" ]; then
	SAND_WEBAUTHN_GATEWAY_TOKEN="${SAND_GATEWAY_TOKEN:-}"
	SAND_WEBAUTHN_GATEWAY_PORT="${SAND_HOST_PORT:-${SAND_BOX_PORT_HOST_GATEWAY}}"
	for SAND_WEBAUTHN_CRED_FILE in \
		"${CHROME_XDG}/sand-gateway-credential" \
		"${BOX_PRIMARY_XDG}/sand-gateway-credential"; do
		[ -r "${SAND_WEBAUTHN_CRED_FILE}" ] || continue
		SAND_WEBAUTHN_FILE_TOKEN="$(sed -n 1p "${SAND_WEBAUTHN_CRED_FILE}" 2>/dev/null || true)"
		if [ -n "${SAND_WEBAUTHN_FILE_TOKEN}" ]; then
			SAND_WEBAUTHN_GATEWAY_TOKEN="${SAND_WEBAUTHN_FILE_TOKEN}"
			SAND_WEBAUTHN_GATEWAY_PORT="$(sed -n 2p "${SAND_WEBAUTHN_CRED_FILE}" 2>/dev/null || true)"
			break
		fi
	done
	CHROME_ENV+=(
		SAND_GATEWAY_TOKEN="${SAND_WEBAUTHN_GATEWAY_TOKEN}"
		SAND_HOST_PORT="${SAND_WEBAUTHN_GATEWAY_PORT:-${SAND_BOX_PORT_HOST_GATEWAY}}"
	)
fi
if [ "$(id -u)" -eq 0 ]; then
	CHROME_ENV=(runuser -u box -- "${CHROME_ENV[@]}")
fi

chrome_ready() {
	curl --max-time 0.2 -fsS "http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version" >/dev/null 2>&1
}

launch_chrome() {
	setsid -f /usr/local/bin/box-bounded-log --run "${CHROME_LOG}" -- \
		"${CHROME_ENV[@]}" \
		nice -n 10 google-chrome-stable "${CHROME_FLAGS[@]}" "$@" \
		</dev/null >/dev/null 2>&1 9>&-
}

wait_for_chrome() {
	local visible="$1"
	for _ in $(seq 1 100); do
		if chrome_ready && { [ "${visible}" -eq 0 ] || DISPLAY="${DISPLAY:-:1}" xdotool search --onlyvisible --class chrome >/dev/null 2>&1; }; then
			return
		fi
		sleep 0.1
	done
	return 1
}

exec 9>"${CHROME_PROFILE}/.sand-launch.lock"
flock -w 15 9 || exit 1

# A force-installed extension gets NO incognito access by default, and Chrome
# reports that by simply not proxying: an incognito window falls through to
# Chrome's own WebAuthn stack, which in a box with no USB shows a "touch your
# key" dialog that can never be satisfied. Grant it the same way the
# chrome://extensions toggle does, by seeding the profile pref. Only while this
# profile's Chrome is down — a running Chrome rewrites Preferences from memory
# on exit and would drop the edit — and re-applied on every cold launch so a
# profile that lost the grant heals itself.
if [ -f "${SAND_WEBAUTHN_MARKER}" ] && [ -r "${SAND_WEBAUTHN_ID_FILE}" ] &&
	! chrome_ready && command -v python3 >/dev/null 2>&1; then
	SAND_INCOGNITO_SEED=(python3 -)
	if [ "$(id -u)" -eq 0 ]; then
		SAND_INCOGNITO_SEED=(runuser -u box -- python3 -)
	fi
	"${SAND_INCOGNITO_SEED[@]}" "${CHROME_PROFILE}/Default/Preferences" "$(cat "${SAND_WEBAUTHN_ID_FILE}")" <<'SAND_INCOGNITO_EOF' || true
import json, os, sys

prefs, extension_id = sys.argv[1], sys.argv[2]
try:
    with open(prefs, encoding="utf-8") as handle:
        settings = json.load(handle)
except (OSError, ValueError):
    settings = {}
entry = (
    settings.setdefault("extensions", {})
    .setdefault("settings", {})
    .setdefault(extension_id, {})
)
if entry.get("incognito") is not True:
    entry["incognito"] = True
    os.makedirs(os.path.dirname(prefs), exist_ok=True)
    with open(prefs, "w", encoding="utf-8") as handle:
        json.dump(settings, handle, separators=(",", ":"))
SAND_INCOGNITO_EOF
fi

if [ "${SAND_CHROME_PREPARE}" -eq 1 ]; then
	chrome_ready || launch_chrome --no-startup-window
	wait_for_chrome 0
	exit
fi

launch_chrome "$@"
wait_for_chrome 1
EOF
chmod +x /usr/local/bin/box-chrome

# Chrome's upload/download dialogs (and Thunar's) use the native GTK3 file
# chooser, which opens at the size remembered in org.gtk.Settings.FileChooser.
# With nothing remembered GTK falls back to ~1124x822 — taller than the 800px
# screen — so Open/Cancel land below the Plank dock and computer-use can't reach
# them without first "fitting to screen". Pre-seeding a fitting size makes GTK
# open the chooser at it, with Open ~60px above the dock.
#
# GTK reads the size from the dconf database of the user the *app* runs as. This
# script and every desktop app (Chrome, Thunar, xfwm4) now run as the SAME box
# user, so the direct write below is the one that matters; the root branch —
# which seeds the box user separately because a root-run script's own write
# would land in /root where box-run Chrome never saw it (the original chooser
# bug) — is kept for robustness if this ever runs as root again. (A gtk.css
# max-height is no backstop: GTK3 ignores max-height on a toplevel, so this is
# the only lever.)
dconf write /org/gtk/settings/file-chooser/window-size "(1100, 680)" 2>/dev/null || true
dconf write /org/gtk/settings/file-chooser/window-position "(90, 60)" 2>/dev/null || true
if [ "$(id -u)" -eq 0 ]; then
	runuser -u box -- env HOME=/home/box \
		dconf write /org/gtk/settings/file-chooser/window-size "(1100, 680)" 2>/dev/null || true
	runuser -u box -- env HOME=/home/box \
		dconf write /org/gtk/settings/file-chooser/window-position "(90, 60)" 2>/dev/null || true
fi

mkdir -p "${HOME}/.local/share/applications"
# StartupWMClass ties running windows to THIS launcher: it must equal the
# --class box-chrome passes (Chrome's --class sets the WM_CLASS class; the
# instance is not settable and carries the non-default --user-data-dir, so it
# can never be the anchor), and it must be a private value no stock desktop
# file claims. With the stock "google-chrome" class, Plank's matcher
# (bamfdaemon) resolves the window by its desktop-ID rule (file basename ==
# lowercased class) to the SYSTEM google-chrome.desktop — Google's own deb
# declares that same class as its StartupWMClass, so it passes bamf's class
# filter and outranks this file — and the dock drew a second, unpinned Chrome
# icon instead of lighting up this pinned launcher. The one shared launcher
# serves every desktop: each display runs its own bamf/Plank pair against only
# its own windows, so a shared class cannot merge two displays' dock entries.
cat >"${HOME}/.local/share/applications/box-chrome.desktop" <<'EOF'
[Desktop Entry]
Version=1.0
Type=Application
Name=Google Chrome
Exec=/usr/local/bin/box-chrome --new-window %U
Icon=google-chrome
StartupWMClass=box-chrome
Categories=Network;WebBrowser;
MimeType=x-scheme-handler/http;x-scheme-handler/https;
EOF

# xdg-open resolves a registered handler BEFORE $BROWSER, so the image's BROWSER
# default alone leaves `xdg-open <url>` on the stock google-chrome.desktop: no
# --disable-dev-shm-usage, so it cannot load pages on the box's 64MB /dev/shm.
mkdir -p "${HOME}/.config" 2>/dev/null || true
cat >"${HOME}/.config/mimeapps.list" <<'EOF'
[Default Applications]
x-scheme-handler/http=box-chrome.desktop
x-scheme-handler/https=box-chrome.desktop
EOF

write_dconf_setting() {
	local path="$1"
	local value="$2"
	for _ in $(seq 1 20); do
		dconf write "${path}" "${value}" >/dev/null 2>&1 || true
		if [ "$(dconf read "${path}" 2>/dev/null || true)" = "${value}" ]; then
			return 0
		fi
		sleep 0.1
	done
	echo "start-desktop: failed to persist dconf ${path}=${value}" >&2
	return 1
}

# Pin a few launchers and start the Plank dock along the bottom edge. Plank
# reads dockitems from ~/.config/plank, so they must exist there before it
# first starts or it prunes them from the dconf dock-items list.
configure_plank_dock() {
	local dock_name="$1"
	local launchers="${HOME}/.config/plank/${dock_name}/launchers"
	local dconf_path="/net/launchpad/plank/docks/${dock_name}"
	local chrome_launcher="${HOME}/.local/share/applications/box-chrome.desktop"
	local thunar_launcher="/usr/share/applications/thunar.desktop"
	local terminal_launcher="/usr/share/applications/xfce4-terminal.desktop"
	mkdir -p "${launchers}"
	printf '[PlankDockItemPreferences]\nLauncher=file://%s\n' \
		"${chrome_launcher}" \
		>"${launchers}/chrome.dockitem"
	printf '[PlankDockItemPreferences]\nLauncher=file://%s\n' \
		"${thunar_launcher}" \
		>"${launchers}/thunar.dockitem"
	printf '[PlankDockItemPreferences]\nLauncher=file://%s\n' \
		"${terminal_launcher}" \
		>"${launchers}/xfce4-terminal.dockitem"
	write_dconf_setting "${dconf_path}/dock-items" "['chrome.dockitem', 'thunar.dockitem', 'xfce4-terminal.dockitem']" || true
	write_dconf_setting "${dconf_path}/position" "'bottom'" || true
	write_dconf_setting "${dconf_path}/theme" "'Transparent'" || true
	write_dconf_setting "${dconf_path}/icon-size" 48 || true
	write_dconf_setting "${dconf_path}/hide-mode" "'none'" || true
}

start_dock_once() {
	local pid_file="$1" log="$2"
	shift 2
	local lock_file="${pid_file}.lock"
	(
		flock -w 10 9 2>/dev/null || true
		local existing=""
		if [ -f "${pid_file}" ]; then
			existing="$(tr -dc '0-9' <"${pid_file}" 2>/dev/null || true)"
		fi
		if [ -n "${existing}" ] && kill -0 "${existing}" >/dev/null 2>&1; then
			exit 0
		fi
		# 9>&- so the long-lived dock does not inherit the lock fd: otherwise it
		# would hold the flock for its whole lifetime and make every later caller
		# block for the full -w timeout. The lock now covers only this fast
		# check-and-spawn, releasing as soon as the subshell exits.
		setsid nohup /usr/local/bin/box-bounded-log --run "${log}" -- "$@" \
			>/dev/null 2>&1 9>&- &
		echo "$!" >"${pid_file}"
	) 9>"${lock_file}"
}

configure_plank_dock dock1

start_dock_once "/tmp/plank${DISPLAY}-dock1.pid" "/tmp/plank${DISPLAY}-dock1.log" \
	/usr/local/bin/box-plank --name dock1
sand_desktop_register "${SAND_DESKTOP_GROUP}" dock 5 "/tmp/plank${DISPLAY}-dock1.log" \
	"$(tr -dc '0-9' <"/tmp/plank${DISPLAY}-dock1.pid" 2>/dev/null || true)" \
	"/tmp/plank${DISPLAY}-dock1.pid" -- \
	/usr/local/bin/box-bounded-log --run "/tmp/plank${DISPLAY}-dock1.log" -- \
	/usr/local/bin/box-plank --name dock1

mkdir -p /workspace
cd /workspace

tail -f /dev/null
