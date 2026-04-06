#!/usr/bin/env bash

# Guard an operation with a confirmation prompt.

main() {
    # If stdin is not a terminal (piped/redirected), assume AI orchestration and skip interactivity
    if [[ ! -t 0 ]]; then
        return 0
    fi

    confirmation_prompt="${1:-"Are you sure you want to continue?"}"
    read -r -p "$confirmation_prompt [Y/n] " ans
    if [[ "$ans" != "Y" && "$ans" != "y" && "$ans" != "" ]]; then
        echo "error: aborted!" 2>&1
        exit 1
    fi
}

main "$@"
