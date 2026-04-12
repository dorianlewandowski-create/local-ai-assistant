import type { ApexResponse } from './apexResponse'

export interface ILLMProvider {
  generateResponse(prompt: string, context: any): Promise<ApexResponse>
}
