export function chunkRemoteResponse(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text.trim()

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf('\n', maxLength)
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = maxLength
    }

    chunks.push(remaining.slice(0, splitIndex).trim())
    remaining = remaining.slice(splitIndex).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

export function formatRemoteAssistantText(text: string): string {
  return text.trim()
}
