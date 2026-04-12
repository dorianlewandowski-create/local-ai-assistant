export { TieredSoulStore } from '@apex/memory'

import { logger } from '../utils/logger'
import { TieredSoulStore as BaseTieredSoulStore } from '@apex/memory'

export const soulStore = new BaseTieredSoulStore({
  logger: {
    debug: (m) => logger.debug(m),
    info: (m) => logger.monologue('info', m),
    warn: (m) => logger.warn(m),
    error: (m) => logger.error(m),
    system: (m) => logger.system(m),
  },
})
void soulStore.init()
