import 'dotenv/config';
import { registerCoreTools } from './core/registerTools';
import { runOpenMac } from './core/openmacApp';
import { logger } from './utils/logger';

registerCoreTools();

export { runOpenMac };

if (require.main === module) {
  runOpenMac().catch((error: any) => {
    logger.error(`Error during processing: ${error.message}`);
    process.exit(1);
  });
}
