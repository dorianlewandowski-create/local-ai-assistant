import { OpenMacTui } from '../ui/tui';
import { logger } from '../utils/logger';
import { sessionLogger } from '../runtime/sessionLogger';
import { vectorStore } from '../db/vectorStore';

export function createTuiClient() {
  const tui = new OpenMacTui();
  logger.setSink(tui);
  sessionLogger.start();
  logger.setMirror(sessionLogger);
  logger.patchConsole();
  logger.system('🔒 Security: Encrypted Vault Linked & Local AI Isolated.');
  logger.system(`📝 Session log: ${sessionLogger.getPath()}`);
  logger.system(`🗂️ Vector store: ${vectorStore.getPath()}`);
  if (vectorStore.isUsingFallbackPath()) {
    logger.warn('Configured VECTOR_STORE_PATH is not writable. Using local fallback vector store.');
  }

  return {
    tui,
    destroy() {
      logger.restoreConsole();
      sessionLogger.stop();
      logger.setMirror(null);
      logger.setSink(null);
      tui.destroy();
    },
  };
}
