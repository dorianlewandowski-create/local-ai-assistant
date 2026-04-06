on run argv
	set listName to item 1 of argv
	set includeCompleted to item 2 of argv
	set outputLines to {}

	tell application "Reminders"
		if listName is not "" then
			set listsToCheck to {list listName}
		else
			set listsToCheck to every list
		end if

		repeat with currentList in listsToCheck
			set currentListName to name of currentList
			if includeCompleted is "true" then
				set reminderItems to reminders of currentList
			else
				set reminderItems to (every reminder of currentList whose completed is false)
			end if
			repeat with itemRef in reminderItems
				set itemTitle to name of itemRef
				set completedValue to completed of itemRef
				set dueLabel to ""
				try
					set dueDateValue to due date of itemRef
					if dueDateValue is not missing value then
						set dueLabel to " | due: " & (dueDateValue as string)
					end if
				end try
				set statusLabel to "open"
				if completedValue is true then set statusLabel to "done"
				set end of outputLines to (currentListName & " | " & statusLabel & " | " & itemTitle & dueLabel)
			end repeat
		end repeat
	end tell

	if (count of outputLines) is 0 then
		return "No reminders found."
	end if

	set AppleScript's text item delimiters to linefeed
	set outputText to outputLines as text
	set AppleScript's text item delimiters to ""
	return outputText
end run
