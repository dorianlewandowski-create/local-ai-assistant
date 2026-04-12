import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

async function runAppleScript(script: string) {
  const { stdout, stderr } = await execFileAsync('osascript', ['-e', script])
  if (stderr && !stdout.trim()) {
    throw new Error(stderr.trim())
  }

  return stdout.trim()
}

// --- TODAY SCHEDULE TOOL ---
const TodayScheduleParams = z.object({})

export const getTodaySchedule: Tool<typeof TodayScheduleParams> = {
  name: 'get_today_schedule',
  description: "Read today's appointments from the local macOS Calendar app. This is read-only.",
  parameters: TodayScheduleParams,
  execute: async () => {
    try {
      logger.system('📅 Reading macOS Calendar to verify schedule...')
      const script = `
        set nowDate to current date
        set startOfDay to nowDate
        set time of startOfDay to 0
        set endOfDay to startOfDay + (1 * days)
        set outputLines to {}

        tell application "Calendar"
          repeat with cal in every calendar
            set calName to name of cal
            set todaysEvents to every event of cal whose start date < endOfDay and end date > startOfDay
            repeat with e in todaysEvents
              set eventTitle to summary of e
              set eventStart to (start date of e) as string
              set eventEnd to (end date of e) as string
              set end of outputLines to (calName & " | " & eventTitle & " | " & eventStart & " | " & eventEnd)
            end repeat
          end repeat
        end tell

        if (count of outputLines) is 0 then
          return "No appointments found for today."
        end if

        set AppleScript's text item delimiters to linefeed
        set outputText to outputLines as text
        set AppleScript's text item delimiters to ""
        return outputText
      `

      const output = await runAppleScript(script)
      const result = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')

      return { success: true, result: result || 'No appointments found for today.' }
    } catch (error: any) {
      return {
        success: false,
        error: 'Error: Could not access macOS Calendar. Please ensure the app has necessary permissions.',
      }
    }
  },
}

toolRegistry.register(getTodaySchedule)

// --- LIST NAMES TOOL ---
const ListNamesParams = z.object({})

export const calendarListNames: Tool<typeof ListNamesParams> = {
  name: 'calendar_list_names',
  description: 'List the names of all calendars in macOS Calendar app.',
  parameters: ListNamesParams,
  execute: async () => {
    try {
      const script = `
        tell application "Calendar"
          set calendarNames to name of every calendar
        end tell

        if (count of calendarNames) is 0 then
          return "No calendars found."
        end if

        set AppleScript's text item delimiters to linefeed
        set outputText to calendarNames as text
        set AppleScript's text item delimiters to ""
        return outputText
      `
      const result = await runAppleScript(script)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tool
toolRegistry.register(calendarListNames)

// --- CREATE EVENT TOOL ---
const CreateEventParams = z.object({
  title: z.string().describe('The title of the event'),
  startText: z
    .string()
    .describe('The start date and time of the event (e.g., "October 27, 2023 at 10:00:00 AM")'),
  endText: z
    .string()
    .describe('The end date and time of the event (e.g., "October 27, 2023 at 11:00:00 AM")'),
  notes: z.string().optional().describe('Additional notes or description for the event'),
  calendar: z.string().optional().describe('The name of the calendar to add the event to'),
})

export const calendarCreateEvent: Tool<typeof CreateEventParams> = {
  name: 'calendar_create_event',
  description: 'Create a new event in macOS Calendar.',
  parameters: CreateEventParams,
  execute: async ({ title, startText, endText, notes = '', calendar = '' }) => {
    try {
      const script = `
        set eventTitle to ${JSON.stringify(title)}
        set startText to ${JSON.stringify(startText)}
        set endText to ${JSON.stringify(endText)}
        set notesText to ${JSON.stringify(notes)}
        set calendarName to ${JSON.stringify(calendar)}

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
      `
      const result = await runAppleScript(script)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tool
toolRegistry.register(calendarCreateEvent)

// --- DELETE EVENT TOOL ---
const DeleteEventParams = z.object({
  query: z.string().describe('Search query for the event title'),
  dayCount: z.number().default(7).describe('Number of days from today to search for the event'),
  calendar: z.string().optional().describe('The name of the calendar to search in'),
})

export const calendarDeleteEvent: Tool<typeof DeleteEventParams> = {
  name: 'calendar_delete_event',
  description: 'Delete an event in macOS Calendar based on a title query.',
  parameters: DeleteEventParams,
  execute: async ({ query, dayCount = 7, calendar = '' }) => {
    try {
      const script = `
        set queryText to ${JSON.stringify(query)}
        set dayCount to ${dayCount}
        set calendarName to ${JSON.stringify(calendar)}
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
      `
      const result = await runAppleScript(script)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tool
toolRegistry.register(calendarDeleteEvent)

// --- LIST EVENTS TOOL ---
const ListEventsParams = z.object({
  startText: z
    .string()
    .describe('The start date and time to list events from (e.g., "October 27, 2023 at 12:00:00 AM")'),
  dayCount: z.number().default(7).describe('Number of days to list events for'),
  calendar: z.string().optional().describe('The name of the calendar to list events from'),
})

export const calendarListEvents: Tool<typeof ListEventsParams> = {
  name: 'calendar_list_events',
  description: 'List events from macOS Calendar for a given period.',
  parameters: ListEventsParams,
  execute: async ({ startText, dayCount = 7, calendar = '' }) => {
    try {
      const script = `
        set startText to ${JSON.stringify(startText)}
        set dayCount to ${dayCount}
        set calendarName to ${JSON.stringify(calendar)}

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
      `
      const result = await runAppleScript(script)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tool
toolRegistry.register(calendarListEvents)

// --- SEARCH EVENTS TOOL ---
const SearchEventsParams = z.object({
  query: z.string().describe('Search query for the event title'),
  dayCount: z.number().default(7).describe('Number of days from today to search for events'),
  calendar: z.string().optional().describe('The name of the calendar to search in'),
})

export const calendarSearchEvents: Tool<typeof SearchEventsParams> = {
  name: 'calendar_search_events',
  description: 'Search for events in macOS Calendar based on a title query.',
  parameters: SearchEventsParams,
  execute: async ({ query, dayCount = 7, calendar = '' }) => {
    try {
      const script = `
        set queryText to ${JSON.stringify(query)}
        set dayCount to ${dayCount}
        set calendarName to ${JSON.stringify(calendar)}
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
      `
      const result = await runAppleScript(script)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tool
toolRegistry.register(calendarSearchEvents)

// --- UPDATE EVENT TOOL ---
const UpdateEventParams = z.object({
  query: z.string().describe('Search query for the event title to update'),
  newStart: z.string().optional().describe('New start date and time for the event'),
  newEnd: z.string().optional().describe('New end date and time for the event'),
  newTitle: z.string().optional().describe('New title for the event'),
  newNotes: z.string().optional().describe('New notes or description for the event'),
  dayCount: z.number().default(7).describe('Number of days from today to search for the event'),
  calendar: z.string().optional().describe('The name of the calendar to search in'),
})

export const calendarUpdateEvent: Tool<typeof UpdateEventParams> = {
  name: 'calendar_update_event',
  description: 'Update an existing event in macOS Calendar.',
  parameters: UpdateEventParams,
  execute: async ({
    query,
    newStart = '',
    newEnd = '',
    newTitle = '',
    newNotes = '',
    dayCount = 7,
    calendar = '',
  }) => {
    try {
      const script = `
        set queryText to ${JSON.stringify(query)}
        set newStartText to ${JSON.stringify(newStart)}
        set newEndText to ${JSON.stringify(newEnd)}
        set newTitleText to ${JSON.stringify(newTitle)}
        set newNotesText to ${JSON.stringify(newNotes)}
        set dayCount to ${dayCount}
        set calendarName to ${JSON.stringify(calendar)}
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
      `
      const result = await runAppleScript(script)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tool
toolRegistry.register(calendarUpdateEvent)
