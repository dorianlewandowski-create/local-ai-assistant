import { ApexResponse } from './apexResponse'
import type { ILLMProvider } from './ILLMProvider'

export abstract class BaseProvider implements ILLMProvider {
  abstract generateResponse(prompt: string, context: any): Promise<ApexResponse>
}
