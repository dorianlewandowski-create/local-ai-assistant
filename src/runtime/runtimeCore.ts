import { Orchestrator } from '../agent/orchestrator'
import { TaskQueue } from './taskQueue'
import { toolRegistry } from '../tools/registry'
import { openMacAssistantConfig } from '../core/assistantConfig'
import { config } from '@apex/core'
import { recordRouterStatusForPrompt } from '../core/router'
import { emitDebugLog } from './debugIngest'

export function createRuntimeCore() {
  openMacAssistantConfig.tools = toolRegistry.getAllTools().map((tool) => tool.name)
  const orchestrator = new Orchestrator(openMacAssistantConfig)
  const taskQueue = new TaskQueue((task) => {
    recordRouterStatusForPrompt(task.prompt, {
      modelMode: config.modelMode,
      lockedModel: config.lockedModel,
    })
    const correlationId =
      typeof (task.metadata as { correlationId?: unknown } | undefined)?.correlationId === 'string'
        ? String((task.metadata as { correlationId: string }).correlationId)
        : undefined
    emitDebugLog({
      sessionId: '35112d',
      runId: 'gemini-check',
      hypothesisId: 'RC1',
      location: 'src/runtime/runtimeCore.ts:TaskQueueHandler',
      message: 'Dispatching task to orchestrator',
      correlationId,
      data: {
        source: task.source,
        sourceId: String(task.sourceId ?? ''),
        promptLen: String(task.prompt ?? '').length,
        metadataKeys: task.metadata ? Object.keys(task.metadata).slice(0, 20) : [],
        executionProvider: (task.metadata as any)?.executionProvider ?? null,
        correlationId,
      },
      timestamp: Date.now(),
    })
    return orchestrator.processTask(task)
  })

  return {
    orchestrator,
    taskQueue,
  }
}
