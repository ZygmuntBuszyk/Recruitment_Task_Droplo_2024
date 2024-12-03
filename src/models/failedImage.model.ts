import mongoose from 'mongoose';
import {FailedImageSchema} from "../schemas";

export const FailedImageModel = mongoose.model('FailedImage', FailedImageSchema);