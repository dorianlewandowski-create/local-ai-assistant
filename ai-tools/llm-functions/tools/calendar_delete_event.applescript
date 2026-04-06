on run argv
	set queryText to item 1 of argv
	set dayCount to item 2 of argv
	set calendarName to item 3 of argv
	set nowDate to current date
	set endDate to nowDate + ((dayCount as integer) * days)
	set queryLower to do shell script "printf %s " & quoted form of queryText & " | tr '[:upper:]' '[:lower:]'"

	tell application "Calendar"
		if calendarName is not "" then
			set calendarsToCheck to {calendar calendarName}
		else
			set calendarsToCheck to every calendar
		end if

		repeat with cal in calendarsToCheck
			set evts to every event of cal whose start date < endDate and end date > nowDate
			repeat with e in evts
				set eventTitle to summary of e
				set eventLower to do shell script "printf %s " & quoted form of eventTitle & " | tr '[:upper:]' '[:lower:]'"
				if eventLower contains queryLower then
					delete e
					return "Deleted event from '" & (name of cal) & "': " & eventTitle
				end if
			end repeat
		end repeat
	end tell

	return "No matching event found."
end run
