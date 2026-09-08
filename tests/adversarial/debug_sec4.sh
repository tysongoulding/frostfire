#!/usr/bin/env bash
set -x
CHAIN_EFS="/tmp/debug_chain_efs"
rm -rf "$CHAIN_EFS" /tmp/debug_c*
mkdir -p "$CHAIN_EFS"
SYNC_SCRIPT="scripts/sync-workspace-state.sh"

C1_WS="/tmp/debug_c1"
mkdir -p "$C1_WS"
git -C "$C1_WS" init -q
git -C "$C1_WS" config user.name "Chain Agent"
git -C "$C1_WS" config user.email "chain@frostfire.dev"
echo "v1" > "$C1_WS/file1.txt"
git -C "$C1_WS" add .
git -C "$C1_WS" commit -m "v1" -q

echo "v2 staged" > "$C1_WS/file2.txt"
git -C "$C1_WS" add "$C1_WS/file2.txt"

FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" snapshot "chain_agent" "$C1_WS"

C2_WS="/tmp/debug_c2"
git clone -q "$C1_WS" "$C2_WS"
git -C "$C2_WS" fetch -q origin "refs/frostfire/shadow/*:refs/frostfire/shadow/*"
FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" restore "chain_agent" "$C2_WS"

echo "v3" >> "$C2_WS/file1.txt"
FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" snapshot "chain_agent" "$C2_WS"

C3_WS="/tmp/debug_c3"
git clone -q "$C2_WS" "$C3_WS"
git -C "$C3_WS" fetch origin "refs/frostfire/shadow/*:refs/frostfire/shadow/*"

cat "$CHAIN_EFS/.frostfire/state/chain_agent/manifest.json"

FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" restore "chain_agent" "$C3_WS"
echo "Restore exit code: $?"
