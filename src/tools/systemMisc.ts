import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { sendNotification } from '../utils/notifier';

const GetCurrentTimeParams = z.object({});

export const getCurrentTime: Tool<typeof GetCurrentTimeParams> = {
  name: 'get_current_time',
  description: 'Get the current local date and time.',
  parameters: GetCurrentTimeParams,
  execute: async () => {
    try {
      return {
        success: true,
        result: new Date().toLocaleString(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const GetCurrentWeatherParams = z.object({
  location: z.string()
    .min(1, 'Location is required.')
    .describe('Required. The city name, optionally including state or country, such as "London" or "San Francisco, CA". Do not leave this empty.'),
});

export const getCurrentWeather: Tool<typeof GetCurrentWeatherParams> = {
  name: 'get_current_weather',
  description: 'Get the current weather in a given location.',
  parameters: GetCurrentWeatherParams,
  execute: async ({ location }) => {
    try {
      const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      if (!response.ok) {
        throw new Error(`Weather request failed with status ${response.status}`);
      }

      const data: any = await response.json();
      const current = data.current_condition?.[0];
      if (!current) {
        throw new Error('No weather data returned.');
      }

      const description = current.weatherDesc?.[0]?.value || 'Unknown';
      const summary = [
        `Location: ${location}`,
        `Condition: ${description}`,
        `Temperature: ${current.temp_C}C`,
        `Feels like: ${current.FeelsLikeC}C`,
        `Humidity: ${current.humidity}%`,
        `Wind: ${current.windspeedKmph} km/h`,
      ].join(', ');

      return { success: true, result: summary };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const SendSystemNotificationParams = z.object({
  message: z.string().min(1, 'Message is required.').describe('The visible notification body shown to the user. Keep it concise and action-oriented.'),
  title: z.string().optional().describe('Optional notification title. Defaults to "OpenMac".'),
  subtitle: z.string().optional().describe('Optional notification subtitle describing the action taken. Defaults to "Action taken".'),
});

export const sendSystemNotification: Tool<typeof SendSystemNotificationParams> = {
  name: 'send_system_notification',
  description: 'Show a macOS system notification to inform the user about an autonomous action or important update.',
  parameters: SendSystemNotificationParams,
  execute: async ({ message, title, subtitle }) => {
    try {
      await sendNotification({ message, title, subtitle });
      return { success: true, result: `Notification sent: ${message}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(getCurrentTime);
toolRegistry.register(getCurrentWeather);
toolRegistry.register(sendSystemNotification);
