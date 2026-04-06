tell application "Google Chrome"
	if count of windows is 0 then
		return "Google Chrome is not running or has no windows open."
	end if
	set current_url to URL of active tab of front window
	set current_title to title of active tab of front window
	return current_title & " | " & current_url
end tell
