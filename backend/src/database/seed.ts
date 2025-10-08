import { getPool } from './mysql';
import { connectDatabase } from './mysql';
import bcrypt from 'bcryptjs';

const categories = [
  { name: '电子产品', parent_id: null, sort_order: 1 },
  { name: '服装鞋包', parent_id: null, sort_order: 2 },
  { name: '食品生鲜', parent_id: null, sort_order: 3 },
  { name: '家居家装', parent_id: null, sort_order: 4 },
  { name: '图书文娱', parent_id: null, sort_order: 5 },
];

const products = [
  {
    title: 'iPhone 15 Pro Max 256GB',
    description: '全新iPhone 15 Pro Max，A17 Pro芯片，钛金属设计，支持5G网络',
    category_id: 1,
    brand: 'Apple',
    price: 9999.00,
    original_price: 10999.00,
    stock: 100,
    main_image: 'https://placehold.co/400x400/1E90FF/FFFFFF/png?text=iPhone+15+Pro',
  },
  {
    title: '小米14 Ultra 16GB+512GB',
    description: '小米14 Ultra，骁龙8 Gen3，徕卡光学镜头，专业影像旗舰',
    category_id: 1,
    brand: '小米',
    price: 6499.00,
    original_price: 6999.00,
    stock: 150,
    main_image: 'https://placehold.co/400x400/FF6347/FFFFFF/png?text=Xiaomi+14',
  },
  {
    title: 'MacBook Pro 14英寸 M3 芯片',
    description: 'MacBook Pro，M3芯片，16GB内存，512GB存储，Liquid视网膜显示屏',
    category_id: 1,
    brand: 'Apple',
    price: 14999.00,
    original_price: 15999.00,
    stock: 50,
    main_image: 'https://placehold.co/400x400/4169E1/FFFFFF/png?text=MacBook+Pro',
  },
  {
    title: 'AirPods Pro 第二代',
    description: '主动降噪，自适应通透模式，个性化空间音频',
    category_id: 1,
    brand: 'Apple',
    price: 1899.00,
    original_price: 1999.00,
    stock: 200,
    main_image: 'https://placehold.co/400x400/32CD32/FFFFFF/png?text=AirPods+Pro',
  },
  {
    title: '索尼 WH-1000XM5 无线降噪耳机',
    description: '业界领先的降噪性能，30小时电池续航，舒适佩戴',
    category_id: 1,
    brand: '索尼',
    price: 2499.00,
    original_price: 2799.00,
    stock: 80,
    main_image: 'https://placehold.co/400x400/FFD700/000000/png?text=Sony+WH-1000XM5',
  },
  {
    title: 'Nike Air Max 270 运动鞋',
    description: '经典款运动鞋，舒适透气，时尚百搭',
    category_id: 2,
    brand: 'Nike',
    price: 899.00,
    original_price: 1099.00,
    stock: 120,
    main_image: 'https://placehold.co/400x400/FF1493/FFFFFF/png?text=Nike+Air+Max',
  },
  {
    title: 'Adidas Ultra Boost 跑鞋',
    description: '顶级缓震科技，专业跑步体验',
    category_id: 2,
    brand: 'Adidas',
    price: 1299.00,
    original_price: 1499.00,
    stock: 90,
    main_image: 'https://placehold.co/400x400/00CED1/FFFFFF/png?text=Adidas+Boost',
  },
  {
    title: '优衣库 羊毛混纺大衣',
    description: '经典设计，保暖舒适，四季百搭',
    category_id: 2,
    brand: 'UNIQLO',
    price: 599.00,
    original_price: 799.00,
    stock: 150,
    main_image: 'https://placehold.co/400x400/8B4513/FFFFFF/png?text=UNIQLO+Coat',
  },
  {
    title: '有机纯牛奶 250ml*12盒',
    description: '优质奶源，无添加剂，营养健康',
    category_id: 3,
    brand: '蒙牛',
    price: 89.00,
    original_price: 99.00,
    stock: 300,
    main_image: 'https://placehold.co/400x400/87CEEB/000000/png?text=Organic+Milk',
  },
  {
    title: '新鲜进口车厘子 2斤装',
    description: '智利进口，果大肉厚，甜度高',
    category_id: 3,
    brand: null,
    price: 199.00,
    original_price: 249.00,
    stock: 50,
    main_image: 'https://placehold.co/400x400/DC143C/FFFFFF/png?text=Cherry',
  },
];

async function seed() {
  try {
    await connectDatabase();
    console.log('开始填充示例数据...\n');

    const pool = getPool();

    // 清空现有数据
    console.log('清空现有数据...');
    await pool.execute('SET FOREIGN_KEY_CHECKS = 0');
    await pool.execute('TRUNCATE TABLE categories');
    await pool.execute('TRUNCATE TABLE products');
    await pool.execute('TRUNCATE TABLE users');
    await pool.execute('SET FOREIGN_KEY_CHECKS = 1');

    // 插入分类
    console.log('插入商品分类...');
    for (const category of categories) {
      await pool.execute(
        'INSERT INTO categories (name, parent_id, sort_order) VALUES (?, ?, ?)',
        [category.name, category.parent_id, category.sort_order]
      );
    }
    console.log(`✓ 已插入 ${categories.length} 个分类`);

    // 插入商品
    console.log('插入商品...');
    for (const product of products) {
      await pool.execute(
        `INSERT INTO products (title, description, category_id, brand, price, original_price, stock, main_image, sales_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.title,
          product.description,
          product.category_id,
          product.brand,
          product.price,
          product.original_price,
          product.stock,
          product.main_image,
          Math.floor(Math.random() * 1000), // 随机销量
          1
        ]
      );
    }
    console.log(`✓ 已插入 ${products.length} 个商品`);

    // 创建测试用户
    console.log('创建测试用户...');
    const password_hash = await bcrypt.hash('123456', 10);
    await pool.execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['testuser', 'test@example.com', password_hash]
    );
    console.log('✓ 已创建测试用户 (email: test@example.com, password: 123456)');

    console.log('\n✓ 示例数据填充完成！');
    console.log('\n可以使用以下账号登录:');
    console.log('邮箱: test@example.com');
    console.log('密码: 123456');
    
    process.exit(0);
  } catch (error) {
    console.error('填充数据失败:', error);
    process.exit(1);
  }
}

seed();

