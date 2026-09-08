#!/usr/bin/env bash
# Headless multi-display supervisor for Frostfire Cloud Agents (Displays :1, :2, :3)
set -euo pipefail

# Ensure running under sand-exit-watch subreaper supervisor
if [ -z "${SAND_EXIT_WATCH_ACTIVE:-}" ]; then
  if [ -x /usr/local/bin/sand-exit-watch ]; then
    export SAND_EXIT_WATCH_ACTIVE=1
    exec /usr/local/bin/sand-exit-watch -- "$0" "$@"
  elif [ -f /usr/local/bin/sand-exit-watch ]; then
    export SAND_EXIT_WATCH_ACTIVE=1
    exec python3 /usr/local/bin/sand-exit-watch -- "$0" "$@"
  elif [ -f "$(dirname "$0")/sand-exit-watch" ]; then
    export SAND_EXIT_WATCH_ACTIVE=1
    exec python3 "$(dirname "$0")/sand-exit-watch" -- "$0" "$@"
  fi
fi

# Source and initialize cgroups v2 domains and join interactive slice
if [ -f /usr/local/bin/box-cgroups.sh ]; then
  # shellcheck source=/dev/null
  source /usr/local/bin/box-cgroups.sh
  sand_cgroup_setup
  sand_cgroup_join interactive
elif [ -f "$(dirname "$0")/box-cgroups.sh" ]; then
  # shellcheck source=/dev/null
  source "$(dirname "$0")/box-cgroups.sh"
  sand_cgroup_setup
  sand_cgroup_join interactive
fi

TOKEN_DIR="/tmp/sand-novnc-tokens.d"
LOG_DIR="/tmp/frostfire-display-logs"
rm -rf /tmp/.X*-lock /tmp/.X11-unix/* "${LOG_DIR}/*" 2>/dev/null || true
mkdir -p "${TOKEN_DIR}" "${LOG_DIR}" /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix "${TOKEN_DIR}"

pkill -f websockify || true
pkill -f Xvfb || true
pkill -f x11vnc || true
sleep 1

echo "[+] Starting websockify token router on port 6081..."
websockify \
  --web=/usr/share/novnc \
  --heartbeat=30 \
  --token-plugin TokenFile \
  --token-source /tmp/sand-novnc-tokens.txt \
  0.0.0.0:6081 \
  > "${LOG_DIR}/websockify.log" 2>&1 &

spawn_agent_display() {
  local D="$1"
  local RFB=$((5900 + D))
  local TOKEN="agent${D}"

  echo "[+] Initializing Agent ${D} Display :${D} (RFB ${RFB}, Token: ${TOKEN})..."
  Xvfb ":${D}" -screen 0 1280x800x24 -ac +extension GLX +render -noreset > "${LOG_DIR}/xvfb_${D}.log" 2>&1 &

  for _ in {1..30}; do
    if [ -S "/tmp/.X11-unix/X${D}" ]; then
      break
    fi
    sleep 0.1
  done

  DISPLAY=":${D}" xhost +local: > /dev/null 2>&1 || true
  if [ -f /usr/share/backgrounds/frostfire-wallpaper.png ]; then
    DISPLAY=":${D}" feh --bg-fill /usr/share/backgrounds/frostfire-wallpaper.png > /dev/null 2>&1 &
  else
    DISPLAY=":${D}" xsetroot -solid "#1e1e2e" > /dev/null 2>&1 &
  fi
  DISPLAY=":${D}" openbox > /dev/null 2>&1 &
  DISPLAY=":${D}" autocutsel -fork > /dev/null 2>&1 &
  DISPLAY=":${D}" autocutsel -selection CLIPBOARD -fork > /dev/null 2>&1 &
  DISPLAY=":${D}" tint2 -c /etc/tint2/frostfire-dock.tint2rc > /dev/null 2>&1 &
  x11vnc -skip_lockkeys -display ":${D}" -localhost -nopw -shared -forever -noxdamage -rfbport "${RFB}" -quiet > "${LOG_DIR}/x11vnc_${D}.log" 2>&1 &

  echo "${TOKEN}: 127.0.0.1:${RFB}" >> /tmp/sand-novnc-tokens.txt
  echo "user${D}: 127.0.0.1:${RFB}" >> /tmp/sand-novnc-tokens.txt
}

spawn_agent_display 1
spawn_agent_display 2
spawn_agent_display 3

echo "[+] Starting session sync background daemon..."
if [ -f /usr/local/bin/cdp-cookies.mjs ]; then
  node /usr/local/bin/cdp-cookies.mjs > "${LOG_DIR}/cdp-sync.log" 2>&1 &
elif [ -f "$(dirname "$0")/cdp-cookies.mjs" ]; then
  node "$(dirname "$0")/cdp-cookies.mjs" > "${LOG_DIR}/cdp-sync.log" 2>&1 &
fi

echo "[+] Starting window router on port 1339..."
if [ -f /usr/local/bin/sand-window-router.mjs ]; then
  node /usr/local/bin/sand-window-router.mjs 1339 1337 14000 > "${LOG_DIR}/window-router.log" 2>&1 &
elif [ -f "$(dirname "$0")/sand-window-router.mjs" ]; then
  node "$(dirname "$0")/sand-window-router.mjs" 1339 1337 14000 > "${LOG_DIR}/window-router.log" 2>&1 &
fi

echo "[+] Starting Frostfire Agent Daemon..."
if [ -x /usr/local/bin/frostfire-daemon ]; then
  /usr/local/bin/frostfire-daemon > "${LOG_DIR}/frostfire-daemon.log" 2>&1 &
fi

echo "[✓] Multi-agent display multiplexer running! Ports: 6081 (noVNC), 5901-5903 (VNC)"
wait -n
