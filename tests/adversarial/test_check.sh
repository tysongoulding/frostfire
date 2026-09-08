#!/usr/bin/env bash
ws="/tmp/debug_c2"
staged_tree="f1227c728761df1b0e9cd0db8c0328169694a055"
head_commit="9e292b97768cc371322acd69f8fc65bbe647b12d"
echo "staged_tree:"
git -C "$ws" cat-file -t "$staged_tree" || true
echo "head_commit:"
git -C "$ws" cat-file -t "$head_commit" || true
echo "rev-parse HEAD:"
git -C "$ws" rev-parse HEAD || true
echo "git status:"
git -C "$ws" status || true
echo "git log:"
git -C "$ws" log -n 1 || true
