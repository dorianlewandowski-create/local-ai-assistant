on run argv
	set queryText to item 1 of argv
	set dayCount to item 2 of argv
	set calendarName to item 3 of argv
	set nowDate to current date
	set endDate to nowDate + ((dayCount as integer) * days)
	set queryLower to do shell script "printf %s " & quoted form of queryText & " | tr '[:upper:]' '[:lower:]'"
	set outputLines to {}

	tell application "Calendar"
		if calendarName is not "" then
			set calendarsToCheck to {calendar calendarName}
		else
			set calendarsToCheck to every calendar
		end if

		repeat with cal in calendarsToCheck
			set calName to name of cal
			set evts to every event of cal whose start date < endDate and end date > nowDate
			repeat with e in evts
				set eventTitle to summary of e
				set eventLower to do shell script "printf %s " & quoted form of eventTitle & " | tr '[:upper:]' '[:lower:]'"
				if eventLower contains queryLower then
					set end of outputLines to (calName & " | " & eventTitle & " | " & ((start date of e) as string) & " | " & ((end date of e) as string))
				end if
			end repeat
		end repeat
	end tell

	if (count of outputLines) is 0 then
		return "No matching events found."
	end if

	set AppleScript's text item delimiters to linefeed
	set outputText to outputLines as text
	set AppleScript's text item delimiters to ""
	return outputText
end run
