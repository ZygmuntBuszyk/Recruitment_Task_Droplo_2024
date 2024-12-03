import mongoose from 'mongoose';
import { ImageSchema } from '../schemas';

export const ImageModel = mongoose.model('Image', ImageSchema);