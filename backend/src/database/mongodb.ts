import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

export async function connectMongoDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
  
  await mongoose.connect(uri);
  
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB错误');
  });
}

export default mongoose;

