import { ImageProcessor } from './imageProcessor';
import logger from './utils/logger';

let processor: ImageProcessor;

async function main() {
    processor = new ImageProcessor();
    try {
        const result = await processor.start();
        logger.info('Processing result:', result);
        return result;
    } catch (error) {
        logger.error('Processing failed:', error);
        throw error;
    }
}

main()
    .catch(error => {
        console.error('Application error:', error);
        process.exit(1);
    })
    .finally(async () => {
        if (processor) {
            await processor.cleanup();
        }
        process.exit(0);
    });