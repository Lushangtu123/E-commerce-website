import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '电商平台 - 优质商品，品质保证',
  description: '一站式购物平台，提供各类优质商品',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <Header />
        <main className="min-h-screen bg-gray-50">
          {children}
        </main>
        <footer className="bg-gray-800 text-white py-8">
          <div className="container-custom">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <h3 className="font-bold text-lg mb-4">关于我们</h3>
                <p className="text-gray-400">专业的电商平台，为您提供优质的购物体验</p>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">客户服务</h3>
                <ul className="space-y-2 text-gray-400">
                  <li>帮助中心</li>
                  <li>退换货政策</li>
                  <li>配送说明</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">联系我们</h3>
                <ul className="space-y-2 text-gray-400">
                  <li>客服电话: 400-123-4567</li>
                  <li>邮箱: service@example.com</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">关注我们</h3>
                <p className="text-gray-400">获取最新优惠信息</p>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-gray-700 text-center text-gray-400">
              <p>&copy; 2025 电商平台. All rights reserved.</p>
            </div>
          </div>
        </footer>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}

