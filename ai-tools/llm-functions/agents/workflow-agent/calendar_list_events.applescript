on run argv
	set startText to item 1 of argv
	set dayCount to item 2 of argv
	set calendarName to item 3 of argv

	set startDate to date startText
	set endDate to startDate + ((dayCount as integer) * days)
	set outputLines to {}

	tell application "Calendar"
		if calendarName is not "" then
			set calendarsToCheck to {calendar calendarName}
		else
			set calendarsToCheck to every calendar
		end if

		repeat with cal in calendarsToCheck
			set calName to name of cal
			set evts to every event of cal whose start date < endDate and end date > startDate
			repeat with e in evts
				set end of outputLines to (calName & " | " & (summary of e) & " | " & ((start date of e) as string) & " | " & ((end date of e) as string))
			end repeat
		end repeat
	end tell

	if (count of outputLines) is 0 then
		return "No events found."
	end if

	set AppleScript's text item delimiters to linefeed
	set outputText to outputLines as text
	set AppleScript's text item delimiters to ""
	return outputText
end run
