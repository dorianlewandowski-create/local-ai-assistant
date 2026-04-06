#!/usr/bin/env bash
set -e

# @describe Send an iMessage to a contact.
# @option --contact! The name or phone number of the recipient.
# @option --message! The text message to send.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local contact="$argc_contact"
    local msg="$argc_message"

    echo "Preparing to send iMessage to '$contact'..." >> "$LLM_OUTPUT"

    osascript <<OSA
tell application "Messages"
    set targetService to 1st service whose service type is iMessage
    set targetBuddy to buddy "${contact}" of targetService
    send "${msg}" to targetBuddy
end tell
OSA

    echo "Successfully sent message to '$contact'." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
