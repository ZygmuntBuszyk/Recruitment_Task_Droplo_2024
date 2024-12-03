import fs from 'fs';
import axios from 'axios';
import _ from 'lodash';
import sharp from 'sharp';
import mongoose from 'mongoose';
import logger from './utils/logger';
import {
    ProcessorConfig,
    CSVRow,
    ProcessingResult
} from './types';
import {
    ImageModel,
    FailedImageModel
} from './models';
import {IFailedImage} from "./schemas";


export class ImageProcessor {
    private readonly config: Required<ProcessorConfig>;

    constructor(config: ProcessorConfig = {}) {
        this.config = {
            mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/image_processor',
            batchSize: parseInt(process.env.DEFAULT_BATCH_SIZE || '50', 10),
            maxFileSize: 120 * 1024 * 1024, // 120MB
            thumbnailSize: 100,
            ...config
        };
    }

    private async initialize(): Promise<void> {
        try {
            await mongoose.connect(this.config.mongoUri);
            logger.info('MongoDB connected successfully');

            const filePath = new URL('../data/data.csv', import.meta.url).pathname;
            const stats = await fs.promises.stat(filePath);

            if (stats.size > this.config.maxFileSize) {
                throw new Error(`File size exceeds limit of ${this.config.maxFileSize} bytes`);
            }
        } catch (error) {
            logger.error('Initialization failed:', error);
            throw error;
        }
    }

    private async readCSV(): Promise<CSVRow[]> {
        try {
            const filePath = new URL('../data/data.csv', import.meta.url).pathname;
            const data = await fs.promises.readFile(filePath, 'utf-8');
            const rows = data.split('\n').filter(row => row.trim());
            const headersLine = rows.shift();

            if (!headersLine) {
                throw new Error('CSV file is empty or has no headers');
            }

            // Force to lowercase
            const headers = headersLine.split(',').map(header => header.trim().toLowerCase());

            if (!headers.includes('id') || !headers.includes('url') || !headers.includes('index')) {
                throw new Error('Invalid CSV structure: missing required headers');
            }


            const mappedRows = rows.map(row => {
                const values = row.split(',').map(value => value.trim());
                return headers.reduce<Partial<CSVRow>>((obj, header, index) => {
                    obj[header as keyof CSVRow] = values[index];
                    return obj;
                }, {}) as CSVRow;
            })

            const validatedRows = mappedRows.filter(row => this.validateRow(row));

            return validatedRows
        } catch (error) {
            logger.error('CSV reading failed:', error);
            throw error;
        }
    }

    private validateRow(row: CSVRow): boolean {
        return Boolean(
            row.id &&
            row.url &&
            row.index &&
            !isNaN(parseInt(row.index, 10)) &&
            this.validateUrl(row.url)
        );
    }

    private validateUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    private async processThumbnail(id: string, url: string): Promise<Buffer> {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 5000,
                maxContentLength: this.config.maxFileSize
            });

            return await sharp(response.data)
                .resize(this.config.thumbnailSize, this.config.thumbnailSize, {
                    fit: 'cover',
                    withoutEnlargement: true
                })
                .toBuffer();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to process thumbnail for ID ${id}: ${errorMessage}`);
        }
    }

    private async processChunk(rows: CSVRow[]): Promise<number> {
        let successCount = 0;

        for (const row of rows) {
            try {
                const existingImage = await ImageModel.findOne({ id: row.id });
                const thumbnail = await this.processThumbnail(row.id, row.url);

                if (existingImage) {
                    await ImageModel.updateOne(
                        { id: row.id },
                        {
                            index: parseInt(row.index, 10),
                            thumbnail
                        }
                    );
                    logger.info(`Updated existing image ${row.id}`);
                } else {
                    await ImageModel.create({
                        id: row.id,
                        index: parseInt(row.index, 10),
                        thumbnail
                    });
                    logger.info(`Created new image ${row.id}`);
                }

                await FailedImageModel.deleteOne({ id: row.id });

                successCount++;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                await FailedImageModel.findOneAndUpdate(
                    { id: row.id },
                    {
                        id: row.id,
                        index: parseInt(row.index, 10),
                        url: row.url,
                        error: errorMessage,
                        $inc: { attempts: 1 },
                        lastAttempt: new Date()
                    },
                    { upsert: true }
                );

                logger.error(`Failed to process image ${row.id}:`, {
                    id: row.id,
                    url: row.url,
                    error: error instanceof Error ? {
                        message: error.message,
                        stack: error.stack
                    } : error
                });
            }
        }

        return successCount;
    }

    public async getFailedImages() {
        return FailedImageModel.find({}).sort({ lastAttempt: -1 });
    }

    public async retryFailed(maxAttempts = 3): Promise<ProcessingResult> {
        const failedImages = await FailedImageModel.find<IFailedImage>({
            attempts: { $lt: maxAttempts }
        }) as IFailedImage[];

        if (!failedImages || failedImages.length === 0) {
            return {
                total: 0,
                processed: 0,
                failed: 0
            };
        }

        const rows: CSVRow[] = failedImages.map(item => ({
            id: item.id,
            index: item.index.toString(),
            url: item.url
        }));

        return await this.processImages(rows);
    }

    private async processImages(rows: CSVRow[]): Promise<ProcessingResult> {
        const chunks = _.chunk(rows, this.config.batchSize);
        let processedCount = 0;
        let failedCount = 0;

        for (const [index, currentChunk] of chunks.entries()) {
            const successCount = await this.processChunk(currentChunk);
            processedCount += successCount;
            failedCount += currentChunk.length - successCount;

            logger.info(
                `Batch ${index + 1}/${chunks.length} completed. ` +
                `Progress: ${processedCount}/${rows.length} ` +
                `(${failedCount} failures)`
            );
        }

        return {
            total: rows.length,
            processed: processedCount,
            failed: failedCount
        };
    }

    public async cleanup(): Promise<void> {
        try {
            await mongoose.disconnect();
            logger.info('MongoDB disconnected successfully');
        } catch (error) {
            logger.error('Error during cleanup:', error);
        }
    }

    public async start(): Promise<ProcessingResult> {
        try {
            await this.initialize();
            const rows = await this.readCSV();
            logger.info(`Starting to process ${rows.length} images`);

            return await this.processImages(rows);
        } catch (error) {
            logger.error('Processing failed:', error);
            throw error;
        }
    }
}