on run argv
	set queryText to item 1 of argv
	set newStartText to item 2 of argv
	set newEndText to item 3 of argv
	set newTitleText to item 4 of argv
	set newNotesText to item 5 of argv
	set dayCount to item 6 of argv
	set calendarName to item 7 of argv
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
					if newTitleText is not "" then set summary of e to newTitleText
					if newStartText is not "" then set start date of e to date newStartText
					if newEndText is not "" then set end date of e to date newEndText
					if newNotesText is not "" then set description of e to newNotesText
					return "Updated event in '" & (name of cal) & "': " & (summary of e)
				end if
			end repeat
		end repeat
	end tell

	return "No matching event found."
end run
