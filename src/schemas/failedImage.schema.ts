import { Schema } from 'mongoose';

export interface IFailedImage {
    id: string;
    index: number;
    url: string;
    error: string;
    attempts: number;
    lastAttempt: Date;
}

export const FailedImageSchema = new Schema<IFailedImage>({
    id: {
        type: String,
        required: true,
        unique: true
    },
    index: {
        type: Number,
        required: true
    },
    url: {
        type: String,
        required: true
    },
    error: {
        type: String,
        required: true
    },
    attempts: {
        type: Number,
        default: 1
    },
    lastAttempt: {
        type: Date,
        default: Date.now
    }
});