import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import * as path from 'path';

const execAsync = promisify(exec);
const TOOLS_DIR = '/Users/dorianlewandowski/local-ai-assistant/ai-tools/llm-functions/tools';

// --- MAIL READ TOOL ---
const MailReadParams = z.object({
  subject: z.string().describe('The exact subject of the email.'),
  sender: z.string().describe('The exact sender of the email.'),
});

export const mailRead: Tool<typeof MailReadParams> = {
  name: 'mail_read',
  description: 'Read the body of a specific email.',
  parameters: MailReadParams,
  execute: async ({ subject, sender }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'mail_read.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --subject ${JSON.stringify(subject)} --sender ${JSON.stringify(sender)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- MAIL RECENT TOOL ---
const MailRecentParams = z.object({
  limit: z.number().int().optional().default(5).describe('The number of emails to fetch (default 5).'),
});

export const mailRecent: Tool<typeof MailRecentParams> = {
  name: 'mail_recent',
  description: 'Get the most recent emails from the inbox.',
  parameters: MailRecentParams,
  execute: async ({ limit }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'mail_recent.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --limit ${limit}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- MAIL SEARCH TOOL ---
const MailSearchParams = z.object({
  query: z.string().describe('The search query (subject or sender).'),
  limit: z.number().int().optional().default(10).describe('The maximum results (default 10).'),
});

export const mailSearch: Tool<typeof MailSearchParams> = {
  name: 'mail_search',
  description: 'Search for emails in the inbox.',
  parameters: MailSearchParams,
  execute: async ({ query, limit }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'mail_search.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --query ${JSON.stringify(query)} --limit ${limit}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SEND EMAIL (NATIVE) TOOL ---
const SendEmailParams = z.object({
  to: z.string().describe("The recipient's email address."),
  subject: z.string().describe('The subject of the email.'),
  body: z.string().describe('The body text of the email.'),
});

export const sendEmail: Tool<typeof SendEmailParams> = {
  name: 'send_email',
  description: 'Send an email via the native Mail app.',
  parameters: SendEmailParams,
  execute: async ({ to, subject, body }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'send_email.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --to ${JSON.stringify(to)} --subject ${JSON.stringify(subject)} --body ${JSON.stringify(body)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SEND IMESSAGE TOOL ---
const SendImessageParams = z.object({
  contact: z.string().describe('The name or phone number of the recipient.'),
  message: z.string().describe('The text message to send.'),
});

export const sendImessage: Tool<typeof SendImessageParams> = {
  name: 'send_imessage',
  description: 'Send an iMessage to a contact.',
  parameters: SendImessageParams,
  execute: async ({ contact, message }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'send_imessage.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --contact ${JSON.stringify(contact)} --message ${JSON.stringify(message)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SEND MAIL (SMTP) TOOL ---
const SendMailParams = z.object({
  recipient: z.string().describe('The recipient of the email.'),
  subject: z.string().describe('The subject of the email.'),
  body: z.string().describe('The body of the email.'),
});

export const sendMail: Tool<typeof SendMailParams> = {
  name: 'send_mail',
  description: 'Send a email.',
  parameters: SendMailParams,
  execute: async ({ recipient, subject, body }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'send_mail.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --recipient ${JSON.stringify(recipient)} --subject ${JSON.stringify(subject)} --body ${JSON.stringify(body)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SEND TWILIO TOOL ---
const SendTwilioParams = z.object({
  toNumber: z.string().describe("The recipient's phone number. Prefix with 'whatsapp:' for WhatsApp messages, e.g. whatsapp:+1234567890"),
  message: z.string().describe('The content of the message to be sent'),
});

export const sendTwilio: Tool<typeof SendTwilioParams> = {
  name: 'send_twilio',
  description: 'Send SMS or Twilio Messaging Channels messages using Twilio API.',
  parameters: SendTwilioParams,
  execute: async ({ toNumber, message }) => {
    try {
      const scriptPath = path.join(TOOLS_DIR, 'send_twilio.sh');
      const { stdout } = await execAsync(`bash "${scriptPath}" --to-number ${JSON.stringify(toNumber)} --message ${JSON.stringify(message)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// Register tools
toolRegistry.register(mailRead);
toolRegistry.register(mailRecent);
toolRegistry.register(mailSearch);
toolRegistry.register(sendEmail);
toolRegistry.register(sendImessage);
toolRegistry.register(sendMail);
toolRegistry.register(sendTwilio);
