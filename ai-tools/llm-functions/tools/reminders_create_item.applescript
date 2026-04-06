on run argv
	set reminderTitle to item 1 of argv
	set listName to item 2 of argv
	set notesText to item 3 of argv
	set dueText to item 4 of argv
	set dueDateValue to missing value
	if dueText is not "" then
		set dueDateValue to date dueText
	end if

	tell application "Reminders"
		if listName is not "" then
			set targetList to list listName
		else
			set targetList to first list
		end if

		tell targetList
			if dueDateValue is missing value then
				set newReminder to make new reminder with properties {name:reminderTitle, body:notesText}
			else
				set newReminder to make new reminder with properties {name:reminderTitle, body:notesText, due date:dueDateValue}
			end if
		end tell
		return "Created reminder in '" & (name of targetList) & "': " & reminderTitle
	end tell
end run
