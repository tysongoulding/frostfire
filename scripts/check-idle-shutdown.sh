#!/usr/bin/env bash
# Frostfire Host Auto-Idle Shutdown Daemon
# Checks active connections on SSH (22) or noVNC (6080) every 5 minutes.
# Automatically halts the EC2 Spot instance if idle for >= 20 minutes to guarantee <$5/mo budget.

set -euo pipefail

# Ensure standard system binary paths are available in cron environment
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

RAW_CONNS=$(ss -nt '( sport = :22 or sport = :6080 )' | grep -v "State" || true)
if [ -z "${RAW_CONNS}" ]; then
    ACTIVE_CONNS=0
else
    ACTIVE_CONNS=$(echo "${RAW_CONNS}" | wc -l)
fi

if [ "${ACTIVE_CONNS}" -eq 0 ]; then
    IDLE_MINS=$(cat /tmp/frostfire_idle_counter 2>/dev/null || echo 0)
    IDLE_MINS=$((IDLE_MINS + 5))
    echo "${IDLE_MINS}" > /tmp/frostfire_idle_counter
    echo "[frostfire-idle] No active sessions on ports 22/6080. Idle count: ${IDLE_MINS} minutes."
    if [ "${IDLE_MINS}" -ge 20 ]; then
        echo "[frostfire-idle] Inactive for 20+ minutes. Initiating safe shutdown of EC2 Spot instance..."
        sudo shutdown -h now
    fi
else
    echo 0 > /tmp/frostfire_idle_counter
    echo "[frostfire-idle] Active connections detected (${ACTIVE_CONNS}). Idle counter reset."
fi
