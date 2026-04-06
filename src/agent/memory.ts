import { vectorStore } from '../db/vectorStore';

export interface ExperienceRecord {
  task: string;
  error: string;
  successPlan: string;
  kind: 'experience' | 'performance_note';
}

export async function saveExperience(task: string, error: string, successPlan: string) {
  const normalizedTask = task.trim();
  const normalizedError = error.trim();
  const normalizedPlan = successPlan.trim();

  if (!normalizedTask || !normalizedError || !normalizedPlan) {
    return;
  }

  await vectorStore.store({
    source: 'experience',
    scope: 'memory',
    content: `Task: ${normalizedTask}\nError: ${normalizedError}\nSuccess Plan: ${normalizedPlan}`,
    metadata: {
      type: 'experience',
      task: normalizedTask,
      error: normalizedError,
      successPlan: normalizedPlan,
    },
  });
}

export async function savePerformanceNote(task: string, note: string) {
  const normalizedTask = task.trim();
  const normalizedNote = note.trim();

  if (!normalizedTask || !normalizedNote) {
    return;
  }

  await vectorStore.store({
    source: 'performance',
    scope: 'memory',
    content: `Task: ${normalizedTask}\nPerformance Note: ${normalizedNote}`,
    metadata: {
      type: 'performance_note',
      task: normalizedTask,
      successPlan: normalizedNote,
    },
  });
}

export async function findRelevantExperience(task: string, limit = 3): Promise<ExperienceRecord[]> {
  const matches = await vectorStore.searchSimilar(task, limit);
  return matches
    .filter((match) => match.metadata?.type === 'experience' || match.metadata?.type === 'performance_note')
    .map((match) => ({
      task: typeof match.metadata?.task === 'string' ? match.metadata.task : task,
      error: typeof match.metadata?.error === 'string' ? match.metadata.error : 'Previous task was slow or unreliable.',
      successPlan: typeof match.metadata?.successPlan === 'string' ? match.metadata.successPlan : match.content,
      kind: match.metadata?.type === 'performance_note' ? 'performance_note' : 'experience',
    }));
}
