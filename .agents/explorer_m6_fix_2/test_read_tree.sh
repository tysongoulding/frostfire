#!/usr/bin/env bash
set -e

test_diff_tree() {
    echo "=== TEST: diff-tree comparison ==="
    TEST_DIR="/tmp/test_diff_tree"
    rm -rf "$TEST_DIR"
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "Test"

    echo "keep" > keep.txt
    echo "del me" > del.txt
    echo "orig" > orig.txt
    git add .
    git commit -m "init" -q
    head_commit=$(git rev-parse HEAD)

    # Delete del.txt, rename orig.txt -> ren.txt
    rm del.txt
    git mv orig.txt ren.txt
    git add -u
    working_tree=$(git write-tree)

    echo "diff-tree --diff-filter=D between head_commit and working_tree:"
    git diff-tree -r --name-only --diff-filter=D "$head_commit" "$working_tree"

    rm -rf "$TEST_DIR"
}

test_diff_tree
