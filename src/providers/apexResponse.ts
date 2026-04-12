import type { ToolCall } from '@apex/types'

export interface ApexResponse {
  text: string
  toolCalls: ToolCall[]
}
