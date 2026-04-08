import { Message } from '../types';
import { config } from '../config';

export async function chatWithGemini(messages: Message[], model = 'gemini-1.5-pro'): Promise<string> {
  const apiKey = config.apiKeys.gemini;
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Add GOOGLE_GEMINI_API_KEY to .env');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
