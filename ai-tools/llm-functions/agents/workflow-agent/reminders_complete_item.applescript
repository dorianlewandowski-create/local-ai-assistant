on run argv
	set reminderTitle to item 1 of argv
	set listName to item 2 of argv
	set searchTitle to do shell script "printf %s " & quoted form of reminderTitle & " | tr '[:upper:]' '[:lower:]'"

	tell application "Reminders"
		if listName is not "" then
			set listsToCheck to {list listName}
		else
			set listsToCheck to every list
		end if

		repeat with currentList in listsToCheck
			set reminderItems to (every reminder of currentList whose completed is false)
			repeat with targetReminder in reminderItems
				set currentTitle to name of targetReminder
				set normalizedTitle to do shell script "printf %s " & quoted form of currentTitle & " | tr '[:upper:]' '[:lower:]'"
				if normalizedTitle contains searchTitle then
					set completed of targetReminder to true
					return "Completed reminder in '" & (name of currentList) & "': " & currentTitle
				end if
			end repeat

			set exactMatches to (every reminder of currentList whose name is reminderTitle and completed is false)
			if (count of exactMatches) > 0 then
				set targetReminder to item 1 of exactMatches
				set completed of targetReminder to true
				return "Completed reminder in '" & (name of currentList) & "': " & reminderTitle
			end if
		end repeat
	end tell

	return "No open reminder found with title: " & reminderTitle
end run
