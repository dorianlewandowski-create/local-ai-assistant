tell application "Safari"
	if count of windows is 0 then
		return "Safari is not running or has no windows open."
	end if
	set current_url to URL of front document
	set current_title to name of front document
	return current_title & " | " & current_url
end tell
