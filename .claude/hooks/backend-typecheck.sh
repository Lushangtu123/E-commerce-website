#!/bin/bash
# PostToolUse hook: after Claude edits a backend TypeScript file, type-check the backend.
# Exit 2 sends the errors back to Claude so it fixes them before moving on.
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$file" in
  */backend/src/*.ts) ;;
  *) exit 0 ;;
esac

backend="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/backend"
if [ ! -x "$backend/node_modules/.bin/tsc" ]; then
  echo "backend-typecheck: skipped, run npm ci in backend first" >&2
  exit 0
fi

if ! output=$(cd "$backend" && ./node_modules/.bin/tsc --noEmit --pretty false 2>&1); then
  echo "Backend type check failed after editing ${file#"$backend"/}:" >&2
  echo "$output" | head -20 >&2
  exit 2
fi
exit 0
