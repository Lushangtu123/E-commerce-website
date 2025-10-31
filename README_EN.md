# E-Commerce Platform System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)

A modern, full-featured e-commerce platform built with a microservices architecture, implementing complete core e-commerce functionalities with a separation of frontend and backend.

**📚 Chinese Documentation**: [README.md](./README.md) | **🚀 Quick Start**: [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md)

## 🎯 Project Highlights

- 🏗️ **Microservices Architecture** - Modular design for easy scalability
- 🔐 **Complete Permission System** - Dual system for users and administrators
- 💾 **Multi-Database Support** - MySQL + MongoDB + Redis + Elasticsearch
- 🚀 **High Performance Optimization** - Redis caching + database indexing
- 📱 **Responsive Design** - Supports PC, tablet, and mobile devices
- 🐳 **Containerized Deployment** - One-click deployment with Docker Compose

## ✨ Features

### User Features
- ✅ User registration, login, and profile management
- ✅ Product browsing, searching, and filtering
- ✅ **Favorites System** - Add/remove favorites, manage favorite lists 🆕
- ✅ **Search History** - Auto-record search history, popular searches ranking 🆕
- ✅ **Browse History** - Auto-track browsing records, quick repurchase 🆕
- ✅ Shopping cart management - Add/delete/modify items
- ✅ Order creation, payment, viewing, and cancellation
- ✅ Product reviews and ratings

### Product Features
- ✅ Product listing with pagination and sorting
- ✅ Detailed product views
- ✅ **Product SKU Specifications** - Multi-specification product support 🆕
- ✅ Product categorization and filtering
- ✅ Product search (with Elasticsearch full-text search)
- ✅ Popular product recommendations
- ✅ New product recommendations

### Order Features
- ✅ Order creation and checkout
- ✅ Payment processing (simulated)
- ✅ Order status management (pending/paid/shipped/completed)
- ✅ Order cancellation
- ✅ Order confirmation and delivery tracking
- ✅ Detailed order views

### Admin Panel 🆕
- ✅ **Data Analytics Dashboard** - Real-time sales data, order statistics
- ✅ **Product Management** - CRUD operations, bulk status updates, SKU management
- ✅ **Order Management** - Order list, status updates, shipping operations
- ✅ **User Management** - User list, consumption statistics
- ✅ **System Logs** - Admin operation log recording
- ✅ **Permission Control** - JWT authentication, operation permission verification

### Technical Features
- 🚀 Microservices architecture
- 💾 Redis caching optimization
- 📊 Database read-write separation design
- 🔍 Elasticsearch full-text search ready
- 📨 RabbitMQ message queue ready
- 🐳 Docker containerized deployment
- 🔒 JWT authentication
- 🎨 Responsive UI design

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14 + React 18
- **Language**: TypeScript 5
- **Styling**: TailwindCSS 3
- **State Management**: Zustand 4
- **HTTP Client**: Axios
- **UI Components**: React Icons
- **Notifications**: React Hot Toast
- **Charts**: Recharts

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express 4
- **Language**: TypeScript 5
- **Database**: MySQL 8.0
- **Cache**: Redis 7
- **Document Database**: MongoDB 7
- **Search Engine**: Elasticsearch 8
- **Message Queue**: RabbitMQ 3
- **Authentication**: JWT
- **Password Encryption**: Bcrypt

## 📋 System Architecture

```
┌─────────────────┐
│  Frontend Layer │  Next.js + React
└────────┬────────┘
         │
┌────────▼────────┐
│   API Gateway   │  Express
└────────┬────────┘
         │
┌────────▼──────────────────────────────┐
│         Microservices Layer           │
├───────────────────────────────────────┤
│ User Service │ Product │ Order Service│
│ Cart Service │ Review  │ Payment      │
└────────┬──────────────────────────────┘
         │
┌────────▼──────────────────────────────┐
│           Data Layer                  │
├───────────────────────────────────────┤
│ MySQL │ MongoDB │ Redis │ Elasticsearch│
└───────────────────────────────────────┘
```

## 📦 Database Design

### Core Tables (13 Tables)
| Table Name | Description | Status |
|------------|-------------|--------|
| `users` | User information | ✅ |
| `products` | Product catalog | ✅ |
| `product_skus` | Product SKU specifications | 🆕 |
| `categories` | Product categories | ✅ |
| `cart` | Shopping cart | ✅ |
| `orders` | Order records | ✅ |
| `order_items` | Order line items | ✅ |
| `shipping_addresses` | Delivery addresses | ✅ |
| `reviews` | Product reviews and ratings | ✅ |
| `favorites` | Favorites list | 🆕 |
| `search_history` | Search history | 🆕 |
| `browse_history` | Browse history | 🆕 |
| `admin_logs` | Admin operation logs | ✅ |

### Database Features
- ✅ Normalized design (3rd normal form)
- ✅ Reasonable indexing strategy
- ✅ Foreign key constraints
- ✅ JSON field support (SKU specifications)
- ✅ Automatic timestamp updates

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- MySQL 8.0+
- Redis 7+
- MongoDB 7+

### Using Docker Compose (Recommended)

1. **Clone the repository**
```bash
git clone <repository-url>
cd E-commerce-website
```

2. **Start all services**
```bash
docker-compose up -d
```

3. **Wait for services to be ready**
```bash
docker-compose ps
```

4. **Access the application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Admin Panel: http://localhost:3000/admin
- RabbitMQ Management: http://localhost:15672 (admin/admin123)
- Elasticsearch: http://localhost:9200

5. **Initialize the database**
```bash
docker-compose exec backend npm run migrate
docker-compose exec backend npm run seed
```

6. **Initialize admin account**
```bash
./init-admin.sh
# Default admin credentials:
# Username: admin
# Password: admin123
```

### Local Development

#### Backend Setup

1. **Install dependencies**
```bash
cd backend
npm install
```

2. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env file with your database credentials
```

3. **Run database migrations**
```bash
npm run migrate:dev
npm run seed:dev
```

4. **Start development server**
```bash
npm run dev
```

Backend will run on http://localhost:3001

#### Frontend Setup

1. **Install dependencies**
```bash
cd frontend
npm install
```

2. **Configure environment variables**
```bash
cp .env.local.example .env.local
# Edit .env.local file
```

3. **Start development server**
```bash
npm run dev
```

Frontend will run on http://localhost:3000

## 📁 Project Structure

```
E-commerce-website/
├── backend/                    # Backend services
│   ├── src/
│   │   ├── controllers/       # Business logic controllers
│   │   ├── models/            # Data models
│   │   ├── routes/            # API routes
│   │   ├── middleware/        # Express middleware
│   │   ├── database/          # Database connections and migrations
│   │   ├── services/          # Business services
│   │   └── index.ts           # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── frontend/                   # Frontend application
│   ├── src/
│   │   ├── app/               # Next.js pages and routes
│   │   │   ├── admin/        # Admin panel pages
│   │   │   ├── cart/         # Shopping cart
│   │   │   ├── orders/       # Order management
│   │   │   ├── products/     # Product pages
│   │   │   └── ...
│   │   ├── components/        # React components
│   │   ├── lib/              # Utility libraries
│   │   └── store/            # State management
│   ├── public/               # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── docker-compose.yml         # Docker orchestration
├── README.md                  # Project documentation (Chinese)
├── README_EN.md              # Project documentation (English)
└── DEPLOYMENT.md             # Deployment guide
```

## 🔌 API Endpoints (65+ APIs)

### User APIs
- `POST /api/users/register` - User registration
- `POST /api/users/login` - User login
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `GET /api/users/addresses` - Get shipping addresses list
- `POST /api/users/addresses` - Add shipping address

### Product APIs
- `GET /api/products` - Get product list (with pagination, sorting, filtering)
- `GET /api/products/:id` - Get product details (with SKU info)
- `GET /api/products/hot` - Get popular products
- `GET /api/products/categories` - Get product categories
- `GET /api/products/search` - Search products

### Favorites APIs 🆕
- `POST /api/favorites` - Add to favorites
- `DELETE /api/favorites/:id` - Remove from favorites
- `GET /api/favorites` - Get favorites list
- `GET /api/favorites/check/:productId` - Check if favorited

### Search APIs 🆕
- `POST /api/search/history` - Record search history
- `GET /api/search/history` - Get search history
- `DELETE /api/search/history/:keyword` - Delete search record
- `GET /api/search/hot` - Get popular searches

### Browse History APIs 🆕
- `POST /api/browse` - Record browse history
- `GET /api/browse` - Get browse history
- `DELETE /api/browse/:id` - Delete browse record
- `DELETE /api/browse` - Clear all browse history

### Cart APIs
- `GET /api/cart` - Get shopping cart
- `POST /api/cart` - Add item to cart
- `PUT /api/cart/:id` - Update cart item
- `DELETE /api/cart/:id` - Remove item from cart
- `POST /api/cart/checkout` - Checkout cart

### Order APIs
- `POST /api/orders` - Create order
- `GET /api/orders` - Get order list
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/:id/pay` - Process payment
- `POST /api/orders/:id/cancel` - Cancel order
- `POST /api/orders/:id/confirm` - Confirm delivery

### Review APIs
- `POST /api/reviews` - Create review
- `GET /api/reviews/product/:id` - Get product reviews
- `GET /api/reviews/my` - Get user's reviews

### Admin APIs 🆕
**Dashboard:**
- `GET /api/admin/dashboard/stats` - Get statistics data
- `GET /api/admin/dashboard/sales-trend` - Get sales trend
- `GET /api/admin/dashboard/top-products` - Get top products

**Product Management:**
- `GET /api/admin/products` - Get all products
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `PUT /api/admin/products/:id/status` - Update product status
- `PUT /api/admin/products/batch/status` - Batch update status
- `GET /api/admin/products/:id/skus` - Get product SKUs
- `POST /api/admin/products/:id/skus` - Create SKU
- `POST /api/admin/products/:id/skus/batch` - Batch create SKUs

**Order Management:**
- `GET /api/admin/orders` - Get all orders
- `PUT /api/admin/orders/:id` - Update order status
- `GET /api/admin/orders/:id` - Get order details

**User Management:**
- `GET /api/admin/users` - Get all users
- `GET /api/admin/users/:id` - Get user details

**System Logs:**
- `GET /api/admin/logs` - Get operation logs

## 🎯 Performance Optimization

### Caching Strategy
- ✅ Popular products cached in Redis (10 minutes)
- ✅ Product details cached in Redis (5 minutes)
- ✅ User sessions stored in Redis
- ✅ Category data cached

### Database Optimization
- ✅ Proper index design
- ✅ Query optimization
- ✅ Connection pooling
- ✅ Prepared statements

### Frontend Optimization
- ✅ Server-side rendering (SSR)
- ✅ Code splitting
- ✅ Image lazy loading
- ✅ Static asset optimization

## 🔐 Security Features

- JWT token authentication
- Password encryption (bcrypt)
- SQL injection protection
- XSS protection
- CSRF protection
- Rate limiting
- Helmet security headers
- CORS configuration

## 📊 Monitoring and Logging

- Request logging
- Error logging
- Performance monitoring
- Health check endpoints
- Admin activity logs

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## 📈 Development Roadmap

### Completed ✅
- [x] Admin panel system
- [x] Product favorites functionality
- [x] Product SKU specification management
- [x] Search history and popular searches
- [x] Browse history functionality
- [x] Product editing functionality
- [x] Data analytics dashboard
- [x] System operation logs

### In Progress 🚧
- [ ] Elasticsearch product search implementation
- [ ] RabbitMQ message queue processing

### Planned 📋
- [ ] Automated order timeout cancellation
- [ ] Product recommendation algorithm
- [ ] Flash sale functionality
- [ ] Coupon and promotion system
- [ ] Logistics tracking
- [ ] Mobile app version
- [ ] Further performance optimization
- [ ] Unit test coverage
- [ ] CI/CD automation deployment

## 📊 Project Statistics

| Metric | Count |
|--------|-------|
| Lines of Code | 13,700+ |
| Frontend Pages | 20+ |
| API Endpoints | 65+ |
| Database Tables | 13 |
| Feature Modules | 13 |
| Git Commits | 100+ |

## 📚 Documentation

### Core Documentation
- [Quick Start Guide](./QUICK_START_GUIDE.md) - Detailed installation and configuration steps
- [Environment Variables Setup](./ENV_SETUP.md) - Complete environment variables configuration guide 🆕
- [API Documentation](./API.md) - Complete API reference with examples 🆕
- [System Architecture](./ARCHITECTURE.md) - System architecture design and technical decisions 🆕
- [Security Policy](./SECURITY.md) - Security features and vulnerability reporting 🆕
- [Contributing Guide](./CONTRIBUTING.md) - Code standards and contribution workflow 🆕

### Additional Documentation
- [Project Description](./PROJECT_DESCRIPTION.md) - Project description for resumes
- [Chinese Documentation](./README.md) - 中文文档
- [Development Log](./开发日志_前端.md) - Development process records
- [Update Log](./UPDATE_20251029.md) - Latest updates

## 🎨 Interface Preview

### User Interface
- 🏠 Home - Product display, popular recommendations
- 🛍️ Product Details - SKU selection, favorites, reviews
- 🛒 Shopping Cart - Product management, checkout
- 📦 Order List - Order management, payment
- ⭐ Favorites - Favorites management
- 🕐 Browse History - History records

### Admin Interface
- 📊 Dashboard - Sales statistics, trend charts
- 📦 Product Management - CRUD, SKU management
- 📋 Order Management - Order processing, status updates
- 👥 User Management - User list, consumption statistics

## 🐛 Troubleshooting

If you encounter issues, please check:
1. [开发日志_前端.md](./开发日志_前端.md) - Frontend common issues
2. [开发日志_后端.md](./开发日志_后端.md) - Backend common issues
3. [开发日志_管理后台.md](./开发日志_管理后台.md) - Admin panel issues

## 🤝 Contributing

Contributions are welcome! Please feel free to submit Issues and Pull Requests.

### Commit Convention
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation updates
- `style:` Code formatting
- `refactor:` Code refactoring
- `test:` Testing related
- `chore:` Build/tool related

## 📄 License

MIT License

## 👥 Contact

- GitHub: [Lushangtu123](https://github.com/Lushangtu123)
- Repository: [E-commerce-website](https://github.com/Lushangtu123/E-commerce-website)

---

## ⚠️ Important Notice

**This is a learning and demonstration project** that includes core e-commerce system functionality implementations.

### ✅ Production-Ready Features
- JWT authentication
- Password encryption (bcrypt)
- SQL injection protection
- XSS protection
- CSRF protection
- Request rate limiting
- Redis caching
- Docker containerization
- Complete error handling
- Operation log recording

### 🚧 Recommended for Production Deployment
- HTTPS certificate configuration
- Real payment gateway integration
- SMS/Email service integration
- Object storage (OSS)
- CDN configuration
- Monitoring and alerting system
- Backup and recovery plan
- Load balancing configuration
- Unit and integration testing

## 🎓 Technical Highlights

1. **Microservices Architecture**: Modular, scalable design
2. **Full TypeScript Stack**: Type-safe development
3. **Docker Containerization**: One-command deployment
4. **Redis Caching**: Optimized performance
5. **JWT Authentication**: Stateless, secure authentication
6. **Next.js SSR**: SEO-friendly, fast initial load
7. **Responsive Design**: Mobile-first approach
8. **Comprehensive Documentation**: Easy to maintain and deploy

---

**Project Status**: ✅ Core functionality completed and operational

**Last Updated**: October 29, 2025 | **Version**: 2.0.0

