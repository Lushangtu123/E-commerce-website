# Full-Stack E-Commerce Platform

A modern e-commerce platform built with microservices architecture, featuring user management, product catalog, shopping cart, order processing, admin dashboard, and advanced features including product SKU management, favorites system, search history, and browse history with hot search rankings.

## Technology Stack

**Frontend:** Next.js 14, React 18, TypeScript, TailwindCSS, Zustand  
**Backend:** Node.js 18, Express, TypeScript, MySQL 8.0, Redis 7  
**Infrastructure:** Docker, MongoDB, JWT Authentication, Bcrypt

## Key Features

- **User System**: JWT authentication, profile management, secure password encryption
- **Product Management**: Catalog, search, filtering, pagination, categories, SKU variants
- **Favorites System**: Add/remove favorites, favorites list with product details
- **Search Enhancement**: Search history, hot search rankings, search suggestions
- **Browse History**: Auto-tracking, history management, quick re-purchase
- **Shopping Cart**: Real-time inventory check, quantity adjustment
- **Order System**: Order creation, payment processing, status tracking
- **Review System**: Product ratings and reviews
- **Admin Panel**: User/product/order management, SKU management, analytics dashboard, system logs

## Architecture

```
Frontend (Next.js) → API Gateway (Express) → Microservices → Data Layer (MySQL/Redis/MongoDB)
```

## Project Metrics

- **7,500+ lines of code** across 70+ TypeScript/TSX files
- **60+ RESTful APIs** with full CRUD operations
- **18+ responsive pages** (10 user-facing, 7 admin)
- **13 normalized database tables** with proper indexing
- **Average response time: <100ms** with Redis caching
- **Complete microservices implementation** with favorites, SKU, search & browse history

## Technical Achievements

### Performance
- Redis caching (10min hot products, 5min product details)
- Optimized database queries with indexing
- Server-side rendering for SEO

### Security
- JWT token authentication
- Bcrypt password hashing (10 rounds)
- SQL injection protection (parameterized queries)
- XSS protection, CORS configuration

### Code Quality
- Full TypeScript implementation for type safety
- Modular microservices architecture
- RESTful API design
- Comprehensive error handling

## Deployment

Docker Compose orchestration with 7 containers:
- Frontend (port 3000), Backend API (port 3001)
- MySQL, Redis, MongoDB, Elasticsearch, RabbitMQ
- One-command deployment with health checks

## Skills Demonstrated

Full-stack development • Microservices architecture • TypeScript/JavaScript • React & Next.js • RESTful API design • Database design & optimization • Redis caching • JWT authentication • Docker containerization • Git version control

## Project Scale

**Backend:** 11 controllers, 10 models, 11 route groups  
**Frontend:** 18+ pages, 5+ components, 2 state stores  
**Database:** 13 tables with migrations and seed data

---

**Status:** ✅ Production-ready | **Development Time:** 4 weeks | **Role:** Full-Stack Developer
