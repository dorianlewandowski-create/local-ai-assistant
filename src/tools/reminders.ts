import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- CREATE REMINDER TOOL ---
const CreateReminderParams = z.object({
  title: z.string().describe('The title of the reminder'),
  list: z.string().optional().describe('The name of the list to add the reminder to'),
  notes: z.string().optional().describe('Notes for the reminder'),
  dueDate: z.string().optional().describe('Optional due date string (e.g., "tomorrow at 5pm")'),
});

export const remindersCreateItem: Tool<typeof CreateReminderParams> = {
  name: 'reminders_create_item',
  description: 'Create a new reminder item in macOS Reminders.',
  parameters: CreateReminderParams,
  execute: async ({ title, list = '', notes = '', dueDate = '' }) => {
    try {
      const script = `
        set reminderTitle to ${JSON.stringify(title)}
        set listName to ${JSON.stringify(list)}
        set notesText to ${JSON.stringify(notes)}
        set dueText to ${JSON.stringify(dueDate)}
        
        tell application "Reminders"
          if listName is not "" then
            set targetList to list listName
          else
            set targetList to default list
          end if
          
          if dueText is not "" then
            set dueDateValue to date dueText
            make new reminder at targetList with properties {name:reminderTitle, body:notesText, due date:dueDateValue}
          else
            make new reminder at targetList with properties {name:reminderTitle, body:notesText}
          end if
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- LIST REMINDERS TOOL ---
const ListRemindersParams = z.object({
  list: z.string().optional().describe('The name of the list to filter by'),
  includeCompleted: z.boolean().default(false).describe('Whether to include completed reminders'),
});

export const remindersListItems: Tool<typeof ListRemindersParams> = {
  name: 'reminders_list_items',
  description: 'List items from macOS Reminders.',
  parameters: ListRemindersParams,
  execute: async ({ list = '', includeCompleted = false }) => {
    try {
      const script = `
        set listName to ${JSON.stringify(list)}
        set includeCompleted to ${includeCompleted}
        set outputLines to {}
        
        tell application "Reminders"
          if listName is not "" then
            set listsToCheck to {list listName}
          else
            set listsToCheck to every list
          end if
          
          repeat with currentList in listsToCheck
            set currentListName to name of currentList
            if includeCompleted then
              set reminderItems to reminders of currentList
            else
              set reminderItems to (every reminder of currentList whose completed is false)
            end if
            repeat with itemRef in reminderItems
              set itemTitle to name of itemRef
              set statusLabel to "open"
              if completed of itemRef is true then set statusLabel to "done"
              set end of outputLines to (currentListName & " | " & statusLabel & " | " & itemTitle)
            end repeat
          end repeat
        end tell
        
        set AppleScript's text item delimiters to linefeed
        return outputLines as text
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() || "No reminders found." };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- COMPLETE REMINDER TOOL ---
const CompleteReminderParams = z.object({
  title: z.string().describe('The title of the reminder to mark as completed'),
  list: z.string().optional().describe('The name of the list to search in'),
});

export const remindersCompleteItem: Tool<typeof CompleteReminderParams> = {
  name: 'reminders_complete_item',
  description: 'Mark a reminder item as completed in macOS Reminders.',
  parameters: CompleteReminderParams,
  execute: async ({ title, list = '' }) => {
    try {
      const script = `
        set reminderTitle to ${JSON.stringify(title)}
        set listName to ${JSON.stringify(list)}
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
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- LIST REMINDER NAMES TOOL ---
const ListReminderNamesParams = z.object({});

export const remindersListNames: Tool<typeof ListReminderNamesParams> = {
  name: 'reminders_list_names',
  description: 'List all reminder list names in macOS Reminders.',
  parameters: ListReminderNamesParams,
  execute: async () => {
    try {
      const script = `
        tell application "Reminders"
          set listNames to name of every list
        end tell

        if (count of listNames) is 0 then
          return "No reminders lists found."
        end if

        set AppleScript's text item delimiters to linefeed
        set outputText to listNames as text
        set AppleScript's text item delimiters to ""
        return outputText
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- DELETE REMINDER TOOL ---
const DeleteReminderParams = z.object({
  title: z.string().describe('The title of the reminder to delete'),
  list: z.string().optional().describe('The name of the list to search in'),
});

export const remindersDeleteItem: Tool<typeof DeleteReminderParams> = {
  name: 'reminders_delete_item',
  description: 'Delete a reminder item from macOS Reminders.',
  parameters: DeleteReminderParams,
  execute: async ({ title, list = '' }) => {
    try {
      const script = `
        set reminderTitle to ${JSON.stringify(title)}
        set listName to ${JSON.stringify(list)}
        set searchTitle to do shell script "printf %s " & quoted form of reminderTitle & " | tr '[:upper:]' '[:lower:]'"

        tell application "Reminders"
          if listName is not "" then
            set listsToCheck to {list listName}
          else
            set listsToCheck to every list
          end if

          repeat with currentList in listsToCheck
            set reminderItems to every reminder of currentList
            repeat with targetReminder in reminderItems
              set currentTitle to name of targetReminder
              set normalizedTitle to do shell script "printf %s " & quoted form of currentTitle & " | tr '[:upper:]' '[:lower:]'"
              if normalizedTitle contains searchTitle then
                delete targetReminder
                return "Deleted reminder from '" & (name of currentList) & "': " & currentTitle
              end if
            end repeat

            set exactMatches to (every reminder of currentList whose name is reminderTitle)
            if (count of exactMatches) > 0 then
              set targetReminder to item 1 of exactMatches
              delete targetReminder
              return "Deleted reminder from '" & (name of currentList) & "': " & reminderTitle
            end if
          end repeat
        end tell

        return "No reminder found with title: " & reminderTitle
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// Register tools
toolRegistry.register(remindersCreateItem);
toolRegistry.register(remindersListItems);
toolRegistry.register(remindersCompleteItem);
toolRegistry.register(remindersListNames);
toolRegistry.register(remindersDeleteItem);
