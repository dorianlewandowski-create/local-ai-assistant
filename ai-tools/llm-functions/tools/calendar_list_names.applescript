on run argv
	tell application "Calendar"
		set calendarNames to name of every calendar
	end tell

	if (count of calendarNames) is 0 then
		return "No calendars found."
	end if

	set AppleScript's text item delimiters to linefeed
	set outputText to calendarNames as text
	set AppleScript's text item delimiters to ""
	return outputText
end run
