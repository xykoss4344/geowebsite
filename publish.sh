#!/usr/bin/env bash
# Publish every pending CMS edit at once: merge "draft" into "main" (one Netlify build).
set -euo pipefail
cd "$(dirname "$0")"
git fetch origin
git checkout main
git pull --ff-only origin main
git merge --no-edit origin/draft
git push origin main
# Keep draft level with main so the next edits start from the published state.
git push origin main:draft
echo "Published. Netlify is building main now."
