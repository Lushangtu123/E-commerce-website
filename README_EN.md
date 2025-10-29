# E-Commerce Platform System

A modern, full-featured e-commerce platform built with a microservices architecture, implementing complete core e-commerce functionalities with a separation of frontend and backend.

## ✨ Features

### User Features
- ✅ User registration, login, and profile management
- ✅ Product browsing, searching, and filtering
- ✅ Shopping cart management
- ✅ Order creation, payment, and tracking
- ✅ Product reviews and ratings

### Product Features
- ✅ Product listing with pagination
- ✅ Detailed product views
- ✅ Product categorization
- ✅ Full-text product search
- ✅ Popular product recommendations

### Order Features
- ✅ Order creation and checkout
- ✅ Payment processing (simulated)
- ✅ Order status management
- ✅ Order cancellation
- ✅ Order confirmation and delivery tracking

### Admin Features
- ✅ Product management (CRUD operations)
- ✅ User management
- ✅ Order management and processing
- ✅ Dashboard with analytics
- ✅ System logs and monitoring

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

### Core Tables
- `users` - User information and authentication
- `products` - Product catalog
- `orders` - Order records
- `order_items` - Order line items
- `cart` - Shopping cart
- `shipping_addresses` - Delivery addresses
- `reviews` - Product reviews and ratings
- `categories` - Product categories
- `admins` - Admin users

### Indexing Strategy
- Primary key indexes on all tables
- Unique indexes on email, username, order_no
- Standard indexes on category_id, user_id, product_id, status
- Full-text index on product titles

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

## 🔌 API Endpoints

### User Endpoints
- `POST /api/users/register` - User registration
- `POST /api/users/login` - User login
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile

### Product Endpoints
- `GET /api/products` - Get product list
- `GET /api/products/:id` - Get product details
- `GET /api/products/hot` - Get popular products
- `GET /api/products/search` - Search products

### Cart Endpoints
- `GET /api/cart` - Get shopping cart
- `POST /api/cart` - Add item to cart
- `PUT /api/cart` - Update cart item
- `DELETE /api/cart/:id` - Remove item from cart

### Order Endpoints
- `POST /api/orders` - Create order
- `GET /api/orders` - Get order list
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/:id/pay` - Process payment
- `POST /api/orders/:id/cancel` - Cancel order
- `POST /api/orders/:id/confirm` - Confirm delivery

### Review Endpoints
- `POST /api/reviews` - Create review
- `GET /api/reviews/product/:id` - Get product reviews
- `GET /api/reviews/my` - Get user's reviews

### Admin Endpoints
- `POST /api/admin/login` - Admin login
- `GET /api/admin/users` - Get all users
- `PUT /api/admin/users/:id` - Update user
- `GET /api/admin/products` - Get all products
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product
- `GET /api/admin/orders` - Get all orders
- `PUT /api/admin/orders/:id` - Update order status

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

### Completed
- [x] User authentication and management
- [x] Product catalog and search
- [x] Shopping cart functionality
- [x] Order processing system
- [x] Review and rating system
- [x] Admin panel with full CRUD operations
- [x] Redis caching implementation
- [x] Docker containerization

### In Progress
- [ ] Elasticsearch integration for advanced search
- [ ] RabbitMQ message queue implementation
- [ ] Payment gateway integration
- [ ] Email notification system

### Planned
- [ ] Automated order timeout cancellation
- [ ] Product recommendation algorithm
- [ ] Flash sale functionality
- [ ] Coupon and promotion system
- [ ] Logistics tracking
- [ ] Mobile app version
- [ ] Advanced analytics dashboard
- [ ] Multi-language support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Contact

For questions or support, please open an issue on GitHub.

## 🎓 Technical Highlights

1. **Microservices Architecture**: Modular, scalable design
2. **Full TypeScript Stack**: Type-safe development
3. **Docker Containerization**: One-command deployment
4. **Redis Caching**: Optimized performance
5. **JWT Authentication**: Stateless, secure authentication
6. **Next.js SSR**: SEO-friendly, fast initial load
7. **Responsive Design**: Mobile-first approach
8. **Comprehensive Documentation**: Easy to maintain and deploy

## 📊 Project Statistics

### Backend
- Controllers: 9 files, ~1200 lines
- Models: 7 files, ~800 lines
- Routes: 9 files, ~200 lines
- Database: 4 files, ~500 lines
- Services: 1 file, ~200 lines

### Frontend
- Pages: 15+ pages
- Components: 5+ reusable components
- State stores: 2 global stores
- Total code: ~2500+ lines

### Total
- **Total files**: 50+ TypeScript/TSX files
- **Total code**: ~5000+ lines (excluding configuration)
- **Documentation**: ~3000+ lines

---

**Note**: This is a demonstration project. For production use, additional security measures, error handling, and performance optimizations should be implemented.

**Project Status**: ✅ Core functionality completed and operational

**Last Updated**: October 2025

