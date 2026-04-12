import type { AgentConfig } from '@apex/types'
import { ApexCoreOrchestrator } from '@apex/core'
import { toolRegistry } from '../tools/registry'
import { memoryStore } from '../db/memory'
import { getVectorStore } from '../db/vectorStore'
import { logger } from '../utils/logger'
import { AgentFactory } from './factory'
import { assessToolRisk } from './guardian'
import { findRelevantExperience, saveExperience } from './memory'
import { soulStore } from '../runtime/soulStore'
import { modelRouter } from '../models/modelRouter'
import { sessionStore } from '../runtime/sessionStore'
import { brain } from '../brain'
import { activeModelState } from '../runtime/activeModelState'

export class Orchestrator extends ApexCoreOrchestrator {
  constructor(agent: AgentConfig) {
    super(agent, {
      logger: {
        debug: (m) => logger.debug(m),
        system: (m) => logger.system(m),
        status: (m) => logger.status(m),
        chat: (role, m) => logger.chat(role, m),
        thought: (m) => logger.thought(m),
        plan: (m) => logger.plan(m),
        error: (m) => logger.error(m),
      },
      toolRegistry: {
        getOllamaToolsDefinition: (toolNames) => toolRegistry.getOllamaToolsDefinition(toolNames),
        getTool: (name) => toolRegistry.getTool(name),
      },
      sessionStore: {
        getSession: (task) => sessionStore.getSession(task),
        getSessionKey: (task) => sessionStore.getSessionKey(task),
        getSourceKey: (source) => sessionStore.getSourceKey(source),
        formatSessionHistory: (task, limit) => sessionStore.formatSessionHistory(task, limit),
        formatSourceHistory: (source, limit) => sessionStore.formatSourceHistory(source, limit),
        appendInteraction: (task, prompt, response) => sessionStore.appendInteraction(task, prompt, response),
      },
      modelRouter: {
        getRoute: (tier) => {
          const route = modelRouter.getRoute(tier as any)
          activeModelState.set({
            provider: route.provider,
            model: route.model,
            tier: String(tier),
          })
          return route
        },
      },
      brainClient: {
        query: (prompt, context) => brain.query(prompt, context),
      },
      factMemory: {
        formatContext: (q, limit) => memoryStore.formatContext(q, limit),
        formatRecentNotificationContext: (limit) => memoryStore.formatRecentNotificationContext(limit),
      },
      vectorMemory: {
        store: async (input) => {
          try {
            await getVectorStore().store(input as any)
          } catch (error: any) {
            logger.debug(
              `[Memory] Failed to generate embedding/store vector memory: ${error?.message ?? String(error)}`,
            )
            // Graceful degradation: memory indexing must never block the response pipeline.
            return
          }
        },
        searchSimilar: async (q, limit) => {
          try {
            return (await getVectorStore().searchSimilar(q, limit)) as any
          } catch (error: any) {
            logger.debug(
              `[Memory] Failed to generate embedding/search vector memory: ${error?.message ?? String(error)}`,
            )
            // Graceful degradation: similarity search must never block the response pipeline.
            return [] as any
          }
        },
      },
      soulMemory: {
        loadContextualMemory: (context) => soulStore.loadContextualMemory(context),
      },
      experience: {
        findRelevantExperience: (prompt, limit) => findRelevantExperience(prompt, limit),
        saveExperience: (task, error, plan) => saveExperience(task, error, plan),
      },
      risk: {
        assessToolRisk: async (tool, args, source, sessionSettings) =>
          assessToolRisk(tool as any, args, source as any, sessionSettings),
      },
      agentFactory: {
        choose: (prompt, metadata) => new AgentFactory(agent.model, agent.tools).choose(prompt, metadata),
        chooseWithDiagnostics: (prompt, metadata) =>
          new AgentFactory(agent.model, agent.tools).chooseWithDiagnostics(prompt, metadata),
        create: (kind) => new AgentFactory(agent.model, agent.tools).create(kind as any),
      },
    })
  }
}
