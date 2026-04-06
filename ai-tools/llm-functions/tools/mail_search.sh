#!/usr/bin/env bash
set -e

# @describe Search for emails in the inbox.
# @option --query! The search query (subject or sender).
# @option --limit <INT> The maximum results (default 10).

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local query="$argc_query"
    local limit="${argc_limit:-10}"
    
    osascript <<OSA >> "$LLM_OUTPUT"
tell application "Mail"
  set q to "${query}"
  set outputLines to {}
  repeat with mb in (every mailbox of inbox)
    set matches to (every message of mb whose subject contains q or sender contains q)
    set countLimit to (count of matches)
    if countLimit > ${limit} then set countLimit to ${limit}
    repeat with i from 1 to countLimit
      set m to item i of matches
      set end of outputLines to ((subject of m) & " | " & (sender of m) & " | " & ((date received of m) as string))
    end repeat
  end repeat
  if (count of outputLines) is 0 then
    return "No matching mail found."
  end if
  set AppleScript's text item delimiters to linefeed
  set outputText to outputLines as text
  set AppleScript's text item delimiters to ""
  return outputText
end tell
OSA
}

eval "$(argc --argc-eval "$0" "$@")"
