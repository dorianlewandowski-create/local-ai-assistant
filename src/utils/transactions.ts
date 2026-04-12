export { Transaction, TransactionManager } from '@apex/memory'

import { logger } from './logger'
import { TransactionManager as BaseTransactionManager } from '@apex/memory'

export const transactionManager = new BaseTransactionManager({
  logger: {
    debug: (m) => logger.debug(m),
    info: (m) => logger.monologue('info', m),
    warn: (m) => logger.warn(m),
    error: (m) => logger.error(m),
    system: (m) => logger.system(m),
  },
})
