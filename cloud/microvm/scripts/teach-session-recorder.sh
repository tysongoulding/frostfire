#!/usr/bin/env bash
# Records an active agent display and captures user interaction telemetry for Gemini Flash SOP compilation.
# Usage: teach-session-recorder.sh <start|stop> <display_num> [session_id]

set -euo pipefail

ACTION="${1:-start}"
DISPLAY_NUM="${2:-1}"
SESSION_ID="${3:-$(date +%Y%m%dT%H%M%SZ)-$(uuidgen || echo "teach-$$")}"
OUTPUT_DIR="/workspace/teach-sessions/teach-${SESSION_ID}"
PID_FILE="/tmp/teach-${DISPLAY_NUM}.pid"
EVENT_PID_FILE="/tmp/teach-${DISPLAY_NUM}-events.pid"

start_recording() {
  mkdir -p "${OUTPUT_DIR}"
  echo "[+] Starting teach session on Display :${DISPLAY_NUM} -> ${OUTPUT_DIR}"

  # 1. Start FFmpeg screen capture
  ffmpeg -y \
    -video_size 1280x800 \
    -framerate 15 \
    -f x11grab \
    -i ":${DISPLAY_NUM}.0" \
    -c:v libx264 \
    -preset ultrafast \
    -pix_fmt yuv420p \
    "${OUTPUT_DIR}/demo.mp4" > "${OUTPUT_DIR}/ffmpeg.log" 2>&1 &
  FFMPEG_PID=$!
  echo "${FFMPEG_PID}" > "${PID_FILE}"

  # 2. Start X11 event telemetry logger
  (
    DISPLAY=":${DISPLAY_NUM}"
    export DISPLAY
    while kill -0 "${FFMPEG_PID}" 2>/dev/null; do
      ACTIVE_WIN=$(xdotool getactivewindow getwindowname 2>/dev/null || echo "Unknown")
      WIN_CLASS=$(xdotool getactivewindow getwindowclassname 2>/dev/null || echo "Unknown")
      MOUSE_POS=$(xdotool getmouselocation 2>/dev/null || echo "x:0 y:0")
      TIMESTAMP=$(date +%s%3N)
      printf '{"timestamp":%s,"window":"%s","class":"%s","mouse":"%s"}\n' \
        "${TIMESTAMP}" "${ACTIVE_WIN}" "${WIN_CLASS}" "${MOUSE_POS}" >> "${OUTPUT_DIR}/session-events.jsonl"
      sleep 0.5
    done
  ) &
  EVENT_PID=$!
  echo "${EVENT_PID}" > "${EVENT_PID_FILE}"

  # 3. Write metadata
  cat << EOF > "${OUTPUT_DIR}/session.json"
{
  "sessionId": "${SESSION_ID}",
  "display": ":${DISPLAY_NUM}",
  "startedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "videoPath": "${OUTPUT_DIR}/demo.mp4",
  "eventsPath": "${OUTPUT_DIR}/session-events.jsonl",
  "ffmpegPid": ${FFMPEG_PID}
}
EOF

  echo "{\"status\":\"recording\",\"sessionId\":\"${SESSION_ID}\",\"dir\":\"${OUTPUT_DIR}\"}"
}

stop_recording() {
  echo "[+] Stopping teach session on Display :${DISPLAY_NUM}"
  if [ -f "${PID_FILE}" ]; then
    FFMPEG_PID=$(cat "${PID_FILE}")
    kill -SIGINT "${FFMPEG_PID}" 2>/dev/null || true
    wait "${FFMPEG_PID}" 2>/dev/null || true
    rm -f "${PID_FILE}"
  fi

  if [ -f "${EVENT_PID_FILE}" ]; then
    EVENT_PID=$(cat "${EVENT_PID_FILE}")
    kill -TERM "${EVENT_PID}" 2>/dev/null || true
    rm -f "${EVENT_PID_FILE}"
  fi

  echo "{\"status\":\"stopped\",\"sessionId\":\"${SESSION_ID}\",\"outputDir\":\"${OUTPUT_DIR}\"}"
}

case "${ACTION}" in
  start) start_recording ;;
  stop)  stop_recording ;;
  *) echo "Usage: $0 <start|stop> <display_num> [session_id]" >&2; exit 1 ;;
esac
