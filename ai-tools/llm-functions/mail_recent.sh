#!/usr/bin/env bash
set -e

# @describe Get the most recent emails from the inbox.
# @option --limit <INT> The number of emails to fetch (default 5).

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local limit="${argc_limit:-5}"
    
    osascript <<OSA >> "$LLM_OUTPUT"
tell application "Mail"
  set outputLines to {}
  set mb to mailbox "INBOX" of account 1 -- Default to first account inbox
  set recentMessages to (every message of mb whose deleted status is false)
  set countLimit to (count of recentMessages)
  if countLimit > ${limit} then set countLimit to ${limit}
  
  repeat with i from 1 to countLimit
    set m to item i of recentMessages
    set end of outputLines to ((subject of m) & " | " & (sender of m) & " | " & ((date received of m) as string))
  end repeat
  
  if (count of outputLines) is 0 then
    return "No recent mail found."
  end if
  set AppleScript's text item delimiters to linefeed
  set outputText to outputLines as text
  set AppleScript's text item delimiters to ""
  return outputText
end tell
OSA
}

eval "$(argc --argc-eval "$0" "$@")"
