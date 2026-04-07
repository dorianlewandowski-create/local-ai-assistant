import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { transactionManager } from '../utils/transactions';

const CheckpointStartParams = z.object({
  id: z.string().min(1).describe('A unique identifier for this checkpoint (e.g., "update_config_files").'),
  filePaths: z.array(z.string()).describe('The list of files to back up before starting the operation.'),
});

export const checkpointStart: Tool<typeof CheckpointStartParams> = {
  name: 'checkpoint_start',
  description: 'Create a safety checkpoint for a list of files. Use this before performing high-risk file operations or multi-file edits.',
  parameters: CheckpointStartParams,
  execute: async ({ id, filePaths }) => {
    try {
      await transactionManager.startTransaction(id, filePaths);
      return { success: true, result: `Checkpoint '${id}' created for ${filePaths.length} files.` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const CheckpointRollbackParams = z.object({
  id: z.string().min(1).describe('The ID of the checkpoint to roll back to.'),
});

export const checkpointRollback: Tool<typeof CheckpointRollbackParams> = {
  name: 'checkpoint_rollback',
  description: 'Undo all changes made since the specified checkpoint by restoring the backed-up files.',
  parameters: CheckpointRollbackParams,
  execute: async ({ id }) => {
    try {
      const restored = await transactionManager.rollback(id);
      return { success: true, result: `Successfully rolled back checkpoint '${id}'. Restored files: ${restored.join(', ')}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const CheckpointCommitParams = z.object({
  id: z.string().min(1).describe('The ID of the checkpoint to finalize.'),
});

export const checkpointCommit: Tool<typeof CheckpointCommitParams> = {
  name: 'checkpoint_commit',
  description: 'Finalize a checkpoint and delete the backups. Use this when you are certain the operation was successful.',
  parameters: CheckpointCommitParams,
  execute: async ({ id }) => {
    try {
      await transactionManager.commit(id);
      return { success: true, result: `Checkpoint '${id}' committed and backup data cleaned up.` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(checkpointStart);
toolRegistry.register(checkpointRollback);
toolRegistry.register(checkpointCommit);
