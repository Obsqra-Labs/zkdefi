#!/bin/bash
# Rewrite repo to single commit, sole author Obsqra Labs, then force-push to GitHub.
set -e
cd /opt/obsqra.starknet/zkdefi
rm -f .git/index.lock

git checkout --orphan fresh-main
# Start from main's tree but drop worktrees from index
git read-tree main
git rm -r --cached .worktrees 2>/dev/null || true
# Add any untracked/changed files (respects .gitignore)
git add -A
git rm -r --cached .worktrees 2>/dev/null || true
git status -s | wc -l

GIT_AUTHOR_NAME="Obsqra Labs" GIT_AUTHOR_EMAIL="i.am.a.m.faulkner@gmail.com" \
GIT_COMMITTER_NAME="Obsqra Labs" GIT_COMMITTER_EMAIL="i.am.a.m.faulkner@gmail.com" \
git commit -m "zkDeFi Capital OS — Obsqra Labs

Single-commit history. Reputation proofs, credit hub, monitoring, circuits, docs."

git branch -D main
git branch -m main
echo "Done. Run: git push -f origin main"
