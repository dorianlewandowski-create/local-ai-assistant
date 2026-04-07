const MARKDOWN_V2_SPECIAL_CHARS = /([_\*\[\]()~`>#+\-=|{}.!\\])/g;

export function escapeTelegramMarkdown(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIAL_CHARS, '\\$1');
}
