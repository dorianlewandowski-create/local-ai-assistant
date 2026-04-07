#!/bin/bash

# Znajdź prawdziwą ścieżkę do folderu projektu, nawet przez symlinki
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
PROJECT_ROOT="$( cd -P "$( dirname "$SOURCE" )/.." >/dev/null 2>&1 && pwd )"

# Przejdź do głównego folderu projektu
cd "$PROJECT_ROOT"

# Uruchom za pomocą ts-node z lokalnego node_modules
exec npx ts-node src/cli.ts "$@"
