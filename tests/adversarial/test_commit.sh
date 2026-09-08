#!/usr/bin/env bash
ws="/tmp/debug_c2"
staged_tree="f1227c728761df1b0e9cd0db8c0328169694a055"
head_commit="9e292b97768cc371322acd69f8fc65bbe647b12d"
git -C "$ws" commit-tree "$staged_tree" -p "$head_commit" -m "test commit"
