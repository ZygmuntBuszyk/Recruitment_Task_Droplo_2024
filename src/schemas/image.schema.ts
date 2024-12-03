import { Schema } from 'mongoose';

export interface IImage {
    id: string;
    index: number;
    thumbnail: Buffer;
}

export const ImageSchema = new Schema<IImage>({
    id: {
        type: String,
        required: true,
        unique: true
    },
    index: {
        type: Number,
        required: true
    },
    thumbnail: {
        type: Buffer,
        required: true
    }
});