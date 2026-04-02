#!/usr/bin/env bash
set -e

# @describe Send an email via the native Mail app.
# @option --to! The recipient's email address.
# @option --subject! The subject of the email.
# @option --body! The body text of the email.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local to="$argc_to"
    local subject="$argc_subject"
    local body="$argc_body"

    echo "Preparing to send email to '$to'..." >> "$LLM_OUTPUT"

    osascript <<OSA
tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"${subject}", content:"${body}", visible:false}
    tell newMessage
        make new to recipient at end of to recipients with properties {address:"${to}"}
        send
    end tell
end tell
OSA

    echo "Successfully sent email to '$to'." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
