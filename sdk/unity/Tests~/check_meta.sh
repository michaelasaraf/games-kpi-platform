#!/usr/bin/env sh
# Unity ignores files without a .meta in a git (immutable) package, so every file and
# folder of the package needs one. Tests~ is hidden from Unity and is skipped.
set -eu
cd "$(dirname "$0")/.."
missing=0
for f in $(find . -mindepth 1 -not -path './Tests~*' -not -name '*.meta'); do
  if [ ! -f "$f.meta" ]; then echo "missing $f.meta"; missing=1; fi
done
for m in $(find . -name '*.meta' -not -path './Tests~*'); do
  if [ ! -e "${m%.meta}" ]; then echo "orphan $m"; missing=1; fi
done
[ "$missing" -eq 0 ] && echo "Unity package: every file has a .meta"
exit "$missing"
