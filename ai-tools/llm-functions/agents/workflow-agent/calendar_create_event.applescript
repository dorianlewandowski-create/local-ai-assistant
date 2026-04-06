on run argv
	set eventTitle to item 1 of argv
	set startText to item 2 of argv
	set endText to item 3 of argv
	set notesText to item 4 of argv
	set calendarName to item 5 of argv

	set startDate to date startText
	set endDate to date endText

	tell application "Calendar"
		if calendarName is not "" then
			set targetCalendar to calendar calendarName
		else
			set targetCalendar to first calendar
		end if

		tell targetCalendar
			set newEvent to make new event with properties {summary:eventTitle, start date:startDate, end date:endDate, description:notesText}
		end tell
		return "Created event in '" & (name of targetCalendar) & "': " & (summary of newEvent)
	end tell
end run
