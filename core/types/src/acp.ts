export type Block =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolName: string; status: 'pending' | 'complete' }
  | { type: 'ui'; componentName: string; props: Record<string, any> }

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  blocks: Block[]
}
