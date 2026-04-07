import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

export interface Transaction {
  id: string;
  files: Array<{ original: string; backup: string }>;
}

class TransactionManager {
  private activeTransactions = new Map<string, Transaction>();

  async startTransaction(id: string, filePaths: string[]): Promise<void> {
    const transaction: Transaction = { id, files: [] };
    const tDir = path.join(BACKUP_DIR, id);
    await fs.mkdir(tDir, { recursive: true });

    for (const filePath of filePaths) {
      try {
        const absolutePath = path.resolve(filePath);
        const fileName = path.basename(absolutePath);
        const backupPath = path.join(tDir, `${Date.now()}_${fileName}`);
        
        // Only backup if file exists
        await fs.access(absolutePath);
        await fs.copyFile(absolutePath, backupPath);
        
        transaction.files.push({ original: absolutePath, backup: backupPath });
        logger.debug(`[Transaction] Backed up ${absolutePath} to ${backupPath}`);
      } catch (error: any) {
        logger.warn(`[Transaction] Could not backup ${filePath}: ${error.message}`);
      }
    }

    this.activeTransactions.set(id, transaction);
  }

  async rollback(id: string): Promise<string[]> {
    const transaction = this.activeTransactions.get(id);
    if (!transaction) throw new Error(`Transaction ${id} not found.`);

    const restored: string[] = [];
    for (const { original, backup } of transaction.files) {
      await fs.copyFile(backup, original);
      restored.push(original);
    }

    this.activeTransactions.delete(id);
    return restored;
  }

  async commit(id: string): Promise<void> {
    const transaction = this.activeTransactions.get(id);
    if (!transaction) return;

    // Clean up backup directory
    const tDir = path.join(BACKUP_DIR, id);
    await fs.rm(tDir, { recursive: true, force: true });
    
    this.activeTransactions.delete(id);
    logger.debug(`[Transaction] Committed ${id}`);
  }
}

export const transactionManager = new TransactionManager();
