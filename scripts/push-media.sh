#!/usr/bin/env bash
# Pushes public/media to origin in small, size-bounded chunks.
#
# Why: this connection's upload is slow enough that GitHub drops any push
# carrying more than ~20MB ("RPC failed; HTTP 408" / "unexpected disconnect").
# Committing and pushing ~8MB at a time keeps every request well inside the
# server timeout. The loop is resumable — files already committed are skipped,
# so a re-run picks up exactly where a failure left off.
set -uo pipefail
cd "$(dirname "$0")/.."

CHUNK_BYTES=${CHUNK_BYTES:-8000000}
MAX_ATTEMPTS=${MAX_ATTEMPTS:-4}

push_now() {
  local label="$1"
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    if git push origin main >/tmp/pushlog 2>&1; then
      echo "PUSHED $label"
      return 0
    fi
    echo "RETRY $label (attempt $attempt): $(grep -Eo 'HTTP [0-9]+|unexpected disconnect|denied to [^ ]+' /tmp/pushlog | head -1)"
    sleep 8
  done
  echo "FAILED $label"
  tail -3 /tmp/pushlog
  return 1
}

# Anything already committed but not yet on the remote goes first.
if [ -n "$(git log origin/main..main --oneline 2>/dev/null || git log --oneline)" ]; then
  push_now "pending commits" || exit 1
fi

batch=()
batch_bytes=0
n=0

flush() {
  [ ${#batch[@]} -eq 0 ] && return 0
  n=$((n + 1))
  git add -- "${batch[@]}"
  git -c user.name="Claude" -c user.email="noreply@anthropic.com" \
      commit -q -m "Add web-ready media (chunk $n)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
  echo "COMMIT chunk $n: ${#batch[@]} files, $((batch_bytes / 1000000))MB"
  push_now "chunk $n" || exit 1
  batch=()
  batch_bytes=0
}

while IFS= read -r f; do
  sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
  if [ $((batch_bytes + sz)) -gt "$CHUNK_BYTES" ] && [ ${#batch[@]} -gt 0 ]; then
    flush
  fi
  batch+=("$f")
  batch_bytes=$((batch_bytes + sz))
done < <(git ls-files --others --exclude-standard public/media | sort)

flush

echo "DONE all media pushed"
