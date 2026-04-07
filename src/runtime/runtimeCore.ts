import { Orchestrator } from '../agent/orchestrator';
import { TaskQueue } from './taskQueue';
import { toolRegistry } from '../tools/registry';
import { openMacAssistantConfig } from '../core/assistantConfig';

export function createRuntimeCore() {
  openMacAssistantConfig.tools = toolRegistry.getAllTools().map((tool) => tool.name);
  const orchestrator = new Orchestrator(openMacAssistantConfig);
  const taskQueue = new TaskQueue((task) => orchestrator.processTask(task));

  return {
    orchestrator,
    taskQueue,
  };
}
