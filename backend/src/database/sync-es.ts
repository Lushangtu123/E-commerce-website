/**
 * 同步 MySQL 商品数据到 Elasticsearch
 */
import { connectDatabase, getPool } from './mysql';
import {
  initProductIndex,
  bulkSyncProductsToES,
  checkESConnection,
} from './elasticsearch';

async function syncAllProducts() {
  try {
    console.log('🚀 开始同步商品数据到 Elasticsearch...');

    // 连接数据库
    await connectDatabase();
    const pool = getPool();

    // 检查 ES 连接
    const isConnected = await checkESConnection();
    if (!isConnected) {
      throw new Error('无法连接到 Elasticsearch');
    }

    // 初始化索引
    await initProductIndex();

    // 从 MySQL 获取所有商品
    const [products] = await pool.execute(
      `SELECT 
        product_id,
        title,
        description,
        price,
        original_price,
        stock,
        sales_count,
        category_id,
        brand,
        main_image,
        status,
        created_at,
        updated_at
      FROM products`
    );

    const productArray = products as any[];
    console.log(`📦 从 MySQL 获取到 ${productArray.length} 个商品`);

    if (productArray.length === 0) {
      console.log('⚠️ 没有商品需要同步');
      return;
    }

    // 批量同步到 ES
    await bulkSyncProductsToES(productArray);

    console.log('✅ 商品数据同步完成！');
  } catch (error) {
    console.error('❌ 同步失败:', error);
    throw error;
  }
}

// 执行同步
syncAllProducts()
  .then(() => {
    console.log('🎉 同步任务完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 同步任务失败:', error);
    process.exit(1);
  });

