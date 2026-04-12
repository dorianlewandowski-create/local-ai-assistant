#!/bin/bash
# Apex CLI: resolves repo root through symlinks, then runs the bundled entry (dist/cli.bundle.js).
# Keep in sync with release tarball bin/apex and launchd ProgramArguments (bin/run.sh daemon).

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
PROJECT_ROOT="$( cd -P "$( dirname "$SOURCE" )/.." >/dev/null 2>&1 && pwd )"

cd "$PROJECT_ROOT"

exec node "$PROJECT_ROOT/dist/cli.bundle.js" "$@"
