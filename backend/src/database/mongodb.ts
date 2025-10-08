import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export async function connectMongoDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
  
  await mongoose.connect(uri);
  
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB错误:', err);
  });
}

export default mongoose;

