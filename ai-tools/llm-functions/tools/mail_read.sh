#!/usr/bin/env bash
set -e

# @describe Read the body of a specific email.
# @option --subject! The exact subject of the email.
# @option --sender! The exact sender of the email.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local subject="$argc_subject"
    local sender="$argc_sender"
    
    osascript <<OSA >> "$LLM_OUTPUT"
tell application "Mail"
  set subj to "${subject}"
  set sndr to "${sender}"
  repeat with mb in (every mailbox of inbox)
    repeat with m in (every message of mb)
      if (subject of m is subj) and (sender of m is sndr) then
        return ((subject of m) & " | " & (sender of m) & linefeed & (content of m))
      end if
    end repeat
  end repeat
  return "No matching mail body found."
end tell
OSA
}

eval "$(argc --argc-eval "$0" "$@")"
