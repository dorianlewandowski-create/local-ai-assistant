on run argv
	tell application "Reminders"
		set listNames to name of every list
	end tell

	if (count of listNames) is 0 then
		return "No reminders lists found."
	end if

	set AppleScript's text item delimiters to linefeed
	set outputText to listNames as text
	set AppleScript's text item delimiters to ""
	return outputText
end run
