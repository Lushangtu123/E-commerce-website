# E-commerce Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node.js-24_LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

A modern e-commerce platform with a separate frontend and backend. The backend is a single Express application organised into business modules, and it implements the core e-commerce features together with an admin panel.

**Chinese documentation**: [README_ZH.md](./README_ZH.md) | **Quick start**: [QUICKSTART.md](./QUICKSTART.md)

## Highlights

- **Modular monolith** - Routes, controllers and services are split by business domain and deployed as one Express application, which can also be embedded in Next.js and deployed to Vercel
- **Complete permission system** - Separate customer and administrator accounts
- **Storage** - MySQL and Redis, with optional Elasticsearch search and an optional RabbitMQ delay queue
- **Performance** - Redis caching and database index tuning
- **Responsive design** - Works on desktop, tablet and phone
- **Containerised deployment** - One-command deployment with Docker Compose

## Features

### Customer Features

- **Chinese and English interface** - The storefront and admin panel switch between Chinese and English from the language menu. The choice survives refreshes, navigation and signing in again. Dates follow the selected language; product, user and address content stays in its original language, and amounts remain in RMB.
- Registration, sign-in and profile management
- Password change that revokes old sessions; one-time email password reset through configured Gmail SMTP or Resend
- **Account centre** - One place for profile, orders and coupons
- Product browsing, search and filtering
- **Favourites** - Add and remove favourites and manage the favourites list
- Favorite writes serialize per account without locking a missing receipt range. A late initial status read cannot overwrite a successful toggle; repeated pending actions are blocked and switching accounts discards earlier responses.
- **Search history** - Searches are recorded automatically, with a popular-search ranking. Removing a history entry preserves the current query and page.
- **Browsing history** - Viewed products are tracked for quick repurchase
- Shopping cart - Add, remove and change items
- The checkout item count sums the selected purchasable quantities, including multiple pieces of one product or variant.
- **Coupons** - Claim coupons, apply them and calculate discounts
- Coupon lists support pagination and explicit retry after loading failures; administrator usage counts reflect real receipts and current coupon use.
- Order creation, payment, viewing and cancellation
- Product reviews and ratings

### Product Features
- Product list (pagination and sorting)
- Promotion badges and crossed-out original prices appear only when the original price exceeds the selling price, including decimal strings returned by MySQL
- Product details
- **Product SKUs** - Products with multiple variants; the selected variant owns its selling and original prices. A variant without an original price does not inherit a parent discount. Catalog, search and recommendations pair the lowest enabled SKU price with that same SKU’s original price (ties use the lowest SKU ID).
- Categories and filtering
- Product search (full-text with Elasticsearch when configured; falls back to MySQL otherwise or when Elasticsearch fails)
- Popular product recommendations
- New product recommendations

### Order Features
- Order creation and checkout
- Simulated payment (enabled explicitly for local and Preview environments, clearly marked as not charging, disabled in production)
- **Automatic cancellation** - Unpaid orders are cancelled after 30 minutes
- Order status management (pending payment / paid / shipped / completed)
- Order cancellation
- Delivery confirmation
- Durable checkout retry protection: one order per user and request ID, with pending checkout recovery after network failures
- Checkout bounds the combined quantity of each product across variants. Cancellation can restore legacy orders across variants without a product total blocking safe inventory restoration; payment checks the remaining sales-counter range.
- Cart and product loading failures provide an explicit retry; purchasing waits for fresh inventory. Catalog pagination returns to a valid page when listings shrink.
- Payment rejects orders once their 30-minute deadline passes, using database time after taking the order lock. Timeout batches report failures for retry and keep scan progress in Redis across instances.
- Registration, password change and reset share a minimum 12-character, maximum 72-byte UTF-8 policy; existing short passwords remain usable for sign-in
- Carrier and tracking number, after-sales requests, withdrawal, admin review, return parcels and manual refund/closure records (no automatic payment refund or restocking)
- Refresh after-sales progress without losing an unsent return parcel; the admin list shows customer identity, paid amount and refund limits
- Product management separates active/off-sale products from deleted history. Deleted products cannot be selected, edited or republished; a batch containing a deleted or missing product is rejected as a whole.
- Order details
- **Coupons at checkout** - Choose a coupon when placing an order

### Admin Panel
- **Dashboard** - Live sales and order statistics
- Dashboard revenue, average paid order value and top-product sales exclude demo payments. Operational order counts retain them; historical orders without a payment method remain included. Date-based reports continue to group by order creation date.
- **Product management** - Create, edit, bulk list/delist, SKU management
- **Bilingual product content** - Optional English names, descriptions and specification labels, with Chinese fallback for each missing translation. Cart, saved products and new order snapshots follow the selected language.
- **Order management** - Order list, status updates, shipping
- **User management** - User list and spending statistics
- **Coupon management** - Create coupons and manage their status
- **Audit log** - Records administrator actions
- **Access control** - JWT authentication and per-action permission checks

### Technical Features
- Modular monolith (Express)
- Redis caching
- Elasticsearch full-text search (optional; the index is synced on writes and search falls back to MySQL on failure)
- RabbitMQ delay queue (optional; cancels unpaid orders exactly 30 minutes after creation, with a scheduled job as fallback)
- **Automatic order timeout handling** - Order status management driven by a scheduled job
- **Recommendations** - Product recommendations based on user behaviour
- Docker deployment
- JWT authentication
- Responsive UI

## Technology Stack

### Frontend
- **Framework**: Next.js 16 + React 19
- **Language**: TypeScript
- **Styling**: TailwindCSS
- **State management**: Zustand
- **HTTP client**: Axios
- **UI components**: React Icons
- **Notifications**: React Hot Toast

### Backend
- **Runtime**: Node.js 24 LTS
- **Framework**: Express
- **Language**: TypeScript
- **Database**: MySQL 8.0
- **Cache**: Redis 7
- **Search engine**: Elasticsearch 9 (optional)
- **Message queue**: RabbitMQ 3 (optional)
- **Authentication**: JWT

## System Architecture

```
┌─────────────────┐
│  Frontend       │  Next.js + React
└────────┬────────┘
         │
┌────────▼──────────────────────────────┐
│  Express application (one process)    │
│  Middleware: auth / rate limit /      │
│              logging / CSRF           │
├───────────────────────────────────────┤
│ Users │ Products │ Cart │ Orders      │
│ After-sales │ Reviews │ Coupons       │
│ Search │ Recommendations │ Admin      │
└────────┬──────────────────────────────┘
         │
┌────────▼──────────────────────────────┐
│  Data layer                           │
├───────────────────────────────────────┤
│ MySQL │ Redis │ ES (opt.) │ MQ (opt.) │
└───────────────────────────────────────┘
```

## Database Design

### Tables (24)
| Table | Description | Status |
|-------|-------------|--------|
| `users` | Users | Core |
| `products` | Products | Core |
| `product_skus` | Product SKUs | New |
| `categories` | Product categories | Core |
| `cart` | Shopping cart | Core |
| `orders` | Orders | Core |
| `order_items` | Order line items | Core |
| `shipping_addresses` | Shipping addresses | Core |
| `reviews` | Product reviews | Core |
| `favorites` | Favourites | New |
| `search_history` | Search history | New |
| `browse_history` | Browsing history | New |
| `coupons` | Coupons | New |
| `user_coupons` | Coupons claimed by users | New |
| `coupon_usage_logs` | Coupon usage log | New |
| `admins` | Administrators | Core |
| `admin_logs` | Administrator audit log | Core |
| `roles` | Administrator roles | Core |
| `permissions` | Permissions | Core |
| `role_permissions` | Role–permission mapping | Core |
| `traffic_statistics` | Traffic statistics | Core |
| `page_visits` | Page visits | Core |
| `password_reset_tokens` | One-time password reset tokens | Core |
| `after_sales_requests` | After-sales requests | Core |

### Database Characteristics
- Normalised design (third normal form)
- Deliberate indexing strategy
- Foreign key constraints
- JSON columns (SKU specifications)
- Automatically updated timestamps

## Quick Start

### Requirements
- Node.js 24 LTS (an `.nvmrc` is provided at the repository root)
- Docker and Docker Compose
- MySQL 8.0+
- Redis 7+
- Optional: Elasticsearch 9, RabbitMQ 3

### Using Docker Compose (recommended)

1. **Clone the repository**
```bash
git clone <repository-url>
cd E-commerce-website
```

2. **Configure and start all services**
```bash
cp .env.example .env
# In the root .env: set JWT_SECRET to the output of openssl rand -hex 32, and set
# MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD and RABBITMQ_PASSWORD to the output of openssl rand -hex 16 each
docker-compose up -d
```

When deploying under another domain, set both `CORS_ORIGIN` and `NEXT_PUBLIC_API_URL`, then rebuild the frontend.

3. **Wait for the services to start**
```bash
docker-compose ps
```

4. **Open the application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- RabbitMQ management UI: http://localhost:15672 (user `admin`, password from `RABBITMQ_PASSWORD` in `.env`)
- Elasticsearch: http://localhost:9200

The database, Redis, RabbitMQ and Elasticsearch ports are bound to 127.0.0.1 only and cannot be reached from the local network.

5. **Initialise the database**
```bash
docker-compose exec backend npm run migrate
```

### Local Development

#### Backend

1. **Install dependencies**
```bash
cd backend
npm install
```

2. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env and set the database and other connection details
```

3. **Run database migrations**
```bash
npm run migrate:dev
```

For an existing database, run `npm run migrate-review:dev` in `backend` to upgrade only the review constraints; in production run `npm run build` first, then `npm run migrate-review`. The migration can be run repeatedly. It adds a unique constraint on `(order_id, product_id)` and limits ratings to 1–5. Back up the database first: if it finds duplicate historical reviews, invalid ratings or a conflicting constraint with the same name, it stops with an error and keeps the records so they can be checked and fixed by hand before retrying. The full base migration includes this step.

Storefront ratings use the average of published purchase reviews, with `review_count` in product responses. Products without reviews display “No reviews yet”; legacy seeded scores are ignored. Reviews on a product page have five entries per page and can be retried independently of inventory. Saving a review invalidates product caches and refreshes the optional search index; an ancillary cache/index failure does not undo a saved review. Hot-product cache hits reuse only the ranking and hydrate current enabled product data in one bounded database query, including prices, inventory, promotions, translations and review statistics. Removed products are filtered before applying the requested limit. Product details read current product and SKU data on every request, so failed invalidation or a late cache fill cannot revive an older price, stock or enabled variant.

The homepage loads popular products, new arrivals and recommendations independently, with a retry for each failed region. Password recovery distinguishes a failed email capability check (retryable) from an unconfigured email service. Redis read, invalid-payload and write failures on the hot-products endpoint fall back to successful database results.

4. **Start the development server**
```bash
npm run dev
```

The backend runs at http://localhost:3001.

#### Frontend

1. **Install dependencies**
```bash
cd frontend
npm install
```

2. **Configure environment variables**
```bash
cp .env.local.example .env.local
# Edit .env.local
```

3. **Start the development server**
```bash
npm run dev
```

The frontend runs at http://localhost:3000.

## Project Structure

```
E-commerce-website/
├── backend/                 # Backend service
│   ├── src/
│   │   ├── controllers/    # Controllers
│   │   ├── models/         # Data models
│   │   ├── routes/         # Routes
│   │   ├── middleware/     # Middleware
│   │   ├── database/       # Database connections
│   │   └── index.ts        # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── frontend/               # Frontend application
│   ├── src/
│   │   ├── app/           # Next.js pages
│   │   ├── components/    # React components
│   │   ├── lib/           # Utilities
│   │   └── store/         # State management
│   ├── public/            # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── docker-compose.yml      # Docker orchestration
├── scripts/               # Dev helpers (dev/) and manual API checks (manual-tests/)
├── docs/                  # Documentation (design notes in docs/archive/design_plan.txt)
├── README.md              # This file (English)
└── README_ZH.md           # README in Chinese
```

## API Endpoints (100+)

### User APIs
- `POST /api/users/register` - Register
- `POST /api/users/login` - Sign in
- `GET /api/users/profile` - Get the current profile
- `GET /api/users/stats` - Get the user's total orders, unpaid orders, claimed coupons, currently usable coupons and favourites
- `PUT /api/users/profile` - Update the profile
- `PUT /api/users/password` - Verify the current password, change it and revoke all older sessions
- `GET /api/users/password/capabilities` - Check whether password recovery is available
- `POST /api/users/password/forgot` - Request a reset email; safely disabled when the email service is not configured
- `POST /api/users/password/reset` - Reset the password with a one-time token valid for 30 minutes
- `POST /api/users/logout` - Sign out (clears the session cookie)

Password-reset mail supports two backend providers. Gmail uses `EMAIL_PROVIDER=gmail`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `APP_URL`; Resend uses `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL` (the default when `EMAIL_PROVIDER` is unset). Gmail needs an app password for the store's sending account only; registered recipients use their account email and do not need a Gmail account or app password. Store credentials only in backend environment settings, never in client variables or Git. Missing or invalid provider configuration disables recovery. See the [mail configuration and verification guide](./docs/VERCEL_UPSTASH.md).

Registration accepts only a username, email and password. The username is 1–50 characters after trimming surrounding whitespace, the email must be a valid address of at most 100 characters, and the password must be at least 12 characters and at most 72 UTF-8 bytes, with whitespace preserved. Whitespace-only passwords are rejected. Successful registration returns `201`; a username or email conflict, including one caused by concurrent registration, returns `409`. Sign-in keeps accepting the password lengths of existing accounts.

Profile updates accept only `username`, `phone` and `avatar_url`, and at least one must be provided. The phone number is at most 20 characters and the avatar is an HTTP(S) URL of at most 255 characters; both can be cleared with an empty string or `null`. Re-submitting existing values also succeeds. The public profile never includes the password hash, and error messages are available in Chinese and English.

The "Edit profile" entry in the account centre opens `/profile/settings`, which loads the latest profile from the server. The username, phone number and avatar URL can be edited; the email is read-only. After saving, the account centre and the browser cache are updated, and changes survive a refresh; leave the phone number or avatar empty to clear them. Loading failures can be retried, a failed save keeps the draft, and duplicate submissions are blocked while saving. Switching language takes effect immediately, and after switching account or leaving the page, earlier requests cannot overwrite the current profile. The account centre shows the saved avatar, and falls back to a default icon if the image fails to load.

### Address APIs
- `GET /api/addresses` - Get the user's shipping addresses, default address first
- `POST /api/addresses` - Add a complete address; the first one becomes the default, up to 20 per user
- `PUT /api/addresses/:id` - Edit a complete address; `is_default: true` makes it the default
- `DELETE /api/addresses/:id` - Delete one of the user's addresses; deleting the default selects another one automatically

A complete address has six non-empty strings, `receiver_name`, `phone`, `province`, `city`, `district` and `detail_address`, plus an optional boolean `is_default`; it cannot be assigned to another user. Addresses are managed under "Shipping addresses" in the account centre, and checkout requires choosing one.

### Product APIs
- `GET /api/products` - Product list (pagination, sorting and filters)
- `GET /api/products/:id` - Product details, including SKUs
- `GET /api/products/hot` - Popular products
- `GET /api/products/categories` - Product categories
- `POST /api/products`, `PUT /api/products/:id` - Create or update a product (administrators with `product:create` / `product:edit`)

Keyword search uses `GET /api/products?keyword=...` (MySQL) or `GET /api/search/es` (Elasticsearch with MySQL fallback).

### Favourites APIs
- `POST /api/favorites` - Add a favourite; body `{ product_id }`, the product must exist and be on sale
- `POST /api/favorites/toggle` - Toggle the user's favourite; same body
- `DELETE /api/favorites/:product_id` - Remove a favourite by product ID
- `GET /api/favorites/my` - The user's favourites, paginated
- `GET /api/favorites/count` - Number of favourites
- `GET /api/favorites/check/:product_id` - Check whether a product is a favourite
- `POST /api/favorites/check-multiple` - Check several products; body `{ product_ids }` (1–100 positive integers)

### Search APIs
- `GET /api/search/es` - Product search: full-text with Elasticsearch when configured, MySQL otherwise (public; searches by signed-in users are added to their history)
- `GET /api/search/hot` - Popular searches
- `GET /api/search/suggestions` - Suggestions based on search history
- `POST /api/search/record` - Record a search
- `GET /api/search/history` - The user's search history (sign-in required)
- `DELETE /api/search/history` - Clear the user's search history (sign-in required)
- `DELETE /api/search/history/:keyword` - Delete one search entry (sign-in required)

### Browsing History APIs
- `POST /api/browse/record` - Record a view; body `{ product_id }`, the product must exist and be on sale
- `GET /api/browse/history` - Paginated history, one entry per product at its latest view time
- `DELETE /api/browse/history/:product_id` - Delete all of the user's views of a product
- `DELETE /api/browse/history` - Clear the user's browsing history

Favourites and browsing history default to `page=1&limit=20`, with `limit` at most 100. Query parameters must be canonical positive integer strings; duplicate, unknown or invalid parameters are rejected. Product IDs may be any JavaScript safe positive integer. Entries for products that no longer exist can still be deleted and are shown as "Product no longer exists". Both pages can retry failed loads, hide the previous user's data immediately after switching accounts, and move back to a valid page after the last entry on the last page is deleted.

### Cart APIs
- `GET /api/cart` - Get the cart, including SKU snapshots and `available` / `unavailable_reason`
- `POST /api/cart` - Add an item; body `{ product_id, quantity, sku_id? }`
- `PUT /api/cart` - Update a quantity; same body; a quantity of 0 removes that SKU
- `DELETE /api/cart/:id?sku_id=<SKU ID>` - Remove a specific SKU; without `sku_id`, only the line without a SKU is removed
- `DELETE /api/cart` - Empty the current user's cart

### Order APIs
- `POST /api/orders/preview` - With items `{ product_id, quantity, sku_id? }[]`, preview the amount at server-side product/SKU prices and the usable coupons (read-only)
- `POST /api/orders` - Create an order; requires one of the user's valid `shipping_address_id` values and accepts an optional `user_coupon_id`; returns the original amount, discount and amount due. The server stores a snapshot of the shipping details, so later edits or deletion of the address do not change the order
- `GET /api/orders` - The user's orders; `page` defaults to 1, `limit` to 10 (at most 100), optional `status` 0–4; returns `orders`, `total`, `page`, `limit` and `totalPages`
- `GET /api/orders/:id` - Order details
- `GET /api/orders/:id/remaining-time` - Minutes left to pay before automatic cancellation
- `GET /api/payments/settings` - Whether simulated payment is allowed
- `POST /api/orders/:id/pay` - Simulated payment that charges nothing; returns 503 when disabled
- `POST /api/orders/:id/cancel` - Cancel an order

The account centre shows statistics from the server and can retry failed loads; its "Pending payment" entry opens the order list filtered to unpaid orders. The usable-coupon count excludes coupons that are used, expired, not yet valid, disabled or have invalid rules; spending thresholds are checked against the specific order at checkout. The order list keeps its status filter in the URL for reload and Back/Forward; returning through the header shows all orders, and changing status resets pagination. It supports all five statuses and paging in both directions, sorted by creation time and order ID, newest first; if paying or cancelling leaves the current filtered page empty, it moves back to a valid page.
- `POST /api/orders/:id/confirm` - Confirm delivery
- `GET /api/orders/:id/after-sales`, `POST /api/orders/:id/after-sales` - View or submit the user's after-sales request
- `POST /api/orders/:id/after-sales/withdraw` - Withdraw a pending request
- `POST /api/orders/:id/after-sales/return-tracking` - Submit one return parcel for an approved, open return request owned by the customer
- `POST /api/admin/after-sales/:id/complete` - Record manual processing and close an approved request, with `order:edit`; nonzero refunds require a reference and cannot exceed the amount paid, demo payments allow zero only, returns require a parcel first
- `GET /api/admin/after-sales`, `POST /api/admin/after-sales/:id/review` - Admin list and review; at most one request per order, and approval does not refund or restore stock automatically

After-sales progress requires eight nullable columns. Before deploying, back up `after_sales_requests`, build the backend, then check using the target database configuration with `npm run schema:after-sales` in `backend`. If it reports `migration_required`, run `npm run migrate:after-sales` after approval and check again for `ready`. The migration is repeatable and preserves legacy request status, orders, stock and payments; keep the new columns when rolling code back. Builds and API requests never run it automatically.

Coupon claims accept an optional UUID `claim_key`. The storefront persists it before sending a claim, reuses it after an uncertain response or reload, and generates a new ID after confirmation. The same user/key/coupon returns the original receipt without consuming another allocation; changing the coupon with the same key returns 409. Before pushing this feature, back up `user_coupons`, build the backend and run `npm run schema:coupon-claims`. After authorization, run `npm run migrate:coupon-claims` if needed and check again. The repeatable migration adds only nullable `claim_key` and a unique `(user_id, claim_key)` index; preserve both when rolling code back. Legacy requests without a key remain supported.

### Review APIs
- `POST /api/reviews` - Create a review
- `GET /api/reviews/product/:id` - Reviews for a product
- `GET /api/reviews/my` - The user's reviews, optionally filtered to one of their orders with `order_id`, paginated with `page` and `limit`

Users can review only products bought in their own completed orders, once per product per order; a concurrent duplicate returns `409`. The rating must be an integer from 1 to 5, the text is optional and at most 2000 characters, and up to 9 optional HTTP(S) image URLs are allowed (each at most 2048 characters). Creation returns `201`. Lists default to `page=1&limit=10`, at most 100 per page, sorted by creation time and review ID, newest first; unknown fields and invalid IDs or pagination parameters are rejected.

The details page of a completed order includes "Order reviews": all SKUs of the same product share one review, with a 1–5 rating and optional text. On entry it loads every review page for the order and shows existing reviews; duplicate submissions are blocked while saving, a failed save keeps the draft, and a concurrent duplicate reloads the server's record. The interface and system messages are available in Chinese and English, and earlier requests are ignored after switching account, session or order. Image URLs can still be submitted through the API; the current interface offers rating and text.

### Product content languages

Product content is stored separately from interface translations: `title_en`, `description_en` and `specs_en` are optional, and `null` clears them. A specification translation is keyed by the original attribute name, for example `{"颜色":{"name":"Color","value":"Red"},"尺寸":{"name":"Size"}}`. Numeric, boolean and structured attribute values retain their original types; only textual values use the English `value`. Admin product and SKU editors expose the optional English fields and submit only changed fields. English search matches both English and Chinese names/descriptions. New order items store `product_name_en` and `sku_specs_en` at checkout; editing a product later does not change an order's displayed content, and older orders retain their original Chinese snapshots. Existing databases must run the additive `migrate:product-i18n` migration before deploying this code; see [Vercel deployment notes](docs/VERCEL_UPSTASH.md).

### Coupon APIs

**Customer:**
- `GET /api/coupons/available` - Coupons available to claim
- `POST /api/coupons/receive` - Claim a coupon
- `GET /api/coupons/my/list` - The user's coupons
- `GET /api/coupons/my/available-for-order` - Coupons usable for an order
- `POST /api/coupons/calculate` - Calculate a discount
- `GET /api/coupons/:id` - Coupon details

**Admin:**
- `POST /api/admin/coupons` - Create a coupon
- `GET /api/admin/coupons` - Coupon list
- `GET /api/admin/coupons/:id` - Coupon details
- `PUT /api/admin/coupons/:id/status` - Update coupon status

### Recommendation APIs
- `GET /api/recommendations/personalized` - Personalised recommendations from browsing history (sign-in required)
- `GET /api/recommendations/guess-you-like` - "You may also like" (personalised when signed in, popular products otherwise)
- `GET /api/recommendations/related/:productId` - Related products

### Admin APIs
**Session:**
- `POST /api/admin/login` - Administrator sign-in
- `POST /api/admin/logout` - Sign out and invalidate every session of this administrator
- `GET /api/admin/profile` - Administrator profile and permissions

**Statistics:**
- `GET /api/admin/dashboard/stats` - Statistics
- `GET /api/admin/dashboard/sales-trend` - Sales trend
- `GET /api/admin/dashboard/top-products` - Top products
- `GET /api/admin/dashboard/recent-orders` - Latest orders

**Products:**
- `GET /api/admin/products` - Product list
- `POST /api/admin/products` - Create a product
- `PUT /api/admin/products/:id` - Update a product
- `PUT /api/admin/products/:id/status` - Update product status
- `PUT /api/admin/products/batch/status` - Bulk status update
- `DELETE /api/admin/products/:id` - Delete a product (soft delete: the record is kept with status -1)
- `GET /api/admin/products/:id/skus` - All enabled and disabled SKUs; returns `{ product: { product_id, title, status }, skus }`
- `POST /api/admin/products/:id/skus` - Create a SKU
- `POST /api/admin/products/:id/skus/batch` - Create SKUs in bulk
- `PUT /api/admin/products/skus/:skuId` - Update a SKU
- `PUT /api/admin/products/:id/skus/:skuId` - Update a SKU of a specific product, checking that it belongs to that product; requires the `product:edit` permission
- `DELETE /api/admin/products/skus/:skuId` - Disable a SKU, keeping its stock history and order links

**Orders:**
- `GET /api/admin/orders` - Order list
- `GET /api/admin/orders/:id` - Order details
- `PUT /api/admin/orders/:id/status` - Update order status (shipping requires a carrier and tracking number)
- `GET /api/admin/orders/stats/overview` - Order statistics

**Users:**
- `GET /api/admin/users` - User list
- `GET /api/admin/users/:id` - User details
- `GET /api/admin/users/:id/orders` - A user's orders
- `PUT /api/admin/users/:id/status` - Enable or disable a user
- `GET /api/admin/users/stats/overview` - User statistics

**Audit log:**
- `GET /api/admin/logs` - Administrator actions

### Operations
- `GET /health`, `GET /api/health` - Health check; returns 503 only when MySQL or Redis is down (RabbitMQ and Elasticsearch are reported as optional)
- `POST /api/internal/order-timeouts` - Cancels timed-out orders for an external scheduler; requires `Authorization: Bearer <CRON_SECRET>`

## Performance

### Caching
- Popular products cached in Redis (10 minutes)
- Product details cached in Redis (5 minutes)
- Rate-limit counters stored in Redis when `RATE_LIMIT_STORE=redis` or on Vercel (sign-in sessions are signed JWTs in httpOnly cookies, not Redis entries)

### Database
- Deliberate index design
- Query optimisation
- Connection pooling

### Frontend
- Server-side rendering (SSR)
- Code splitting
- Lazy-loaded images
- Static assets served from a CDN

## Security

- JWT authentication
- Hashed password storage (bcrypt)
- SQL injection protection
- XSS protection
- CSRF protection
- Rate limiting

## Monitoring and Logging

- Request logging
- Error logging
- Performance monitoring
- Health check endpoint

## Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests (Vitest + React Testing Library + happy-dom)
cd frontend
npm test
npm run test:watch    # watch mode

# Search, admin session and list regressions (run in frontend)
npx vitest run tests/search-pages.test.tsx tests/admin-session.test.tsx tests/admin-lists.test.tsx
```

Frontend tests use Vitest, React Testing Library and happy-dom. They live in `tests/*.test.ts(x)`, render real components and are included in the `npm run typecheck` type check. Shared setup (clearing localStorage and resetting the URL and Zustand stores) is in `tests/setup.ts`; helpers for awaiting asynchronous results, simulating repeated clicks and inspecting the first render are in `tests/helpers.tsx`.

The full browser checkout regression runs against a real local MySQL test database and covers registration, addresses, simulated payment, shipping, delivery, after-sales review and password change. See the [Vercel / Upstash deployment guide](./docs/VERCEL_UPSTASH.md) for how to run it and for the new database migrations.

Search keywords are trimmed and limited to 100 characters across product search, history and suggestions. History, hot-search and suggestion limits are 1–100; hot-search periods are 1–365 days. Invalid types, ranges and unknown fields return 400 before querying. Search history loads after the sign-in state is restored and is cleared when switching accounts; late responses cannot write into another account. Changing the keyword or sort order in product search returns to the first page, and failed loads can be retried.

Order path IDs use canonical positive decimal integers up to 9007199254740991 consistently for customer and admin reads and updates. Scientific notation, prefixes, signs, leading zeroes and unsafe integers return 400 before accessing order data.

Order details retain their route after a network or temporary server failure and provide an explicit retry. A failed status refresh preserves the last loaded details while blocking payment, cancellation and receipt actions until reloaded. Missing or forbidden orders keep their specific error; late retries cannot affect another account or order.

The admin product, user and log lists all handle expired sign-ins through the API client, and late responses cannot overwrite the current identity or query. Bulk product selection applies only to the current page and is cleared after paging or filtering; product and user write actions block duplicate submissions until the request completes.

"Manage SKUs" in the product list opens `/admin/products/:id/skus`, where SKUs can be added, edited, enabled and disabled, with the total stock and lowest price of enabled SKUs shown. Specification attributes use a name/value form with at most 20 entries and unique names; changing only the price or stock keeps existing numeric and boolean attribute types. Codes are 1–50 characters, start with a letter or digit, and may contain dots, underscores and hyphens; amounts are 0–99999999.99 with at most two decimal places; stock is an integer from 0 to 2147483647; leaving the original price or image URL empty clears it. After the first SKU is added, purchases use SKU prices and stock; once all SKUs are disabled the product cannot be bought, and disabling keeps stock and order links. Actions are recorded in the audit log and clear the product cache. A failed action keeps the input, and if saving succeeds but the refresh fails, only the list is reloaded so nothing is added twice. The page and system messages are available in Chinese and English, and earlier requests are ignored after switching account, session or product.

## Roadmap

### Done
- [x] Admin panel
- [x] Product favourites
- [x] Product SKU management
- [x] Search history and popular searches
- [x] Browsing history
- [x] Product editing
- [x] Statistics dashboard
- [x] Audit logging
- [x] Automatic cancellation of unpaid orders
- [x] Product recommendations
- [x] **Coupons** - Complete coupon feature
- [x] **Account centre** - Single entry point for customer features

### Recently Completed
- [x] Elasticsearch product search: index sync on writes, MySQL fallback, parameter validation (optional dependency)
- [x] RabbitMQ order-timeout delay queue made optional, consumers restored after reconnecting; unused MongoDB removed
- [x] Coupon checkout: server-side preview, reservation in a transaction, coupon returned on cancellation, and order amount snapshots (2026-10-02)
- [x] **Coupons** (2025-11-03)
  - Customer: coupon centre, my coupons, applying coupons
  - Admin: creating coupons, managing status
  - Three coupon types: spend-and-save, percentage discount, no minimum spend
- [x] **Account centre** (2025-11-03)
  - Profile summary
  - Coupon section (prominent design)
  - Feature grid (six shortcuts)
- [x] **Character encoding** (2025-11-03)
  - End-to-end UTF-8
  - Fixed garbled Chinese text
- [x] Automatic cancellation of unpaid orders (2025-10-31)
- [x] Product recommendations (2025-10-31)

### Planned
- [ ] Flash sales
- [ ] Shipment tracking
- [ ] Mobile app
- [ ] Further performance work

## Project Statistics

| Metric | Count |
|--------|-------|
| Lines of code (excluding tests) | 22,000+ |
| Frontend pages | 29 |
| API endpoints | 100+ |
| Database tables | 24 |
| Feature modules | 15 |
| Commits | 180+ |
| Documentation | 7,000+ lines |

## Documentation

### Core
- [Quick start](./QUICKSTART.md) - Detailed installation and configuration steps
- [Environment variables](./ENV_SETUP.md) - Guide to every environment variable
- [API reference](./API.md) - Complete API description with examples
- [Architecture](./ARCHITECTURE.md) - System design and technology choices
- [Security policy](./SECURITY.md) - Security features and vulnerability reporting
- [Contributing](./CONTRIBUTING.md) - Coding standards and contribution process

### Features
- [Coupon frontend guide](./docs/guides/COUPON_FRONTEND_GUIDE.md) - Coupon feature in detail
- [Account centre guide](./docs/guides/PROFILE_PAGE_GUIDE.md) - Account centre features and design
- [Admin guide](./docs/guides/ADMIN_GUIDE.md) - Using the admin panel

### Development (Chinese)
- [Frontend development log](./docs/archive/%E5%BC%80%E5%8F%91%E6%97%A5%E5%BF%97_%E5%89%8D%E7%AB%AF.md) - Frontend development record (3,100+ lines)
- [Backend development log](./docs/archive/%E5%BC%80%E5%8F%91%E6%97%A5%E5%BF%97_%E5%90%8E%E7%AB%AF.md) - Backend development record (3,900+ lines)
- [Admin panel development log](./docs/archive/%E5%BC%80%E5%8F%91%E6%97%A5%E5%BF%97_%E7%AE%A1%E7%90%86%E5%90%8E%E5%8F%B0.md) - Admin panel development record

### Other
- [Project description](./docs/archive/PROJECT_DESCRIPTION.md) - Project summary suitable for a CV
- [Chinese documentation](./README_ZH.md) - The same README in Chinese
- [Update history](./docs/archive/UPDATE_20251029.md) - Earlier updates
- [Archive index](./docs/archive/README.md) - Index of historical update summaries and test reports

## Interface Overview

### Storefront
- Home - Product showcase, popular recommendations, **coupon banner**
- **Account centre** - Profile, orders and coupons in one place
- **Coupon centre** - Claim coupons and see available offers
- **My coupons** - Manage coupons and filter by status
- Product details - SKU selection, favourites, reviews, **related products**
- Cart - Manage items and check out
- Orders - Manage and pay for orders, with a **countdown**
- Favourites - Manage favourites
- Browsing history - Recently viewed products

### Admin Panel
- Dashboard - Sales statistics and trend charts
- Products - Create, edit and manage SKUs
- Orders - Process orders and update status
- Users - User list and spending statistics
- **Coupons** - Create coupons and manage status

## Troubleshooting

If you run into problems, see:
1. [Troubleshooting guide](./TROUBLESHOOTING.md) - Common problems and solutions
2. [Frontend development log](./docs/archive/%E5%BC%80%E5%8F%91%E6%97%A5%E5%BF%97_%E5%89%8D%E7%AB%AF.md) - Common frontend issues (historical, Chinese)
3. [Backend development log](./docs/archive/%E5%BC%80%E5%8F%91%E6%97%A5%E5%BF%97_%E5%90%8E%E7%AB%AF.md) - Common backend issues (historical, Chinese)
4. [Admin panel development log](./docs/archive/%E5%BC%80%E5%8F%91%E6%97%A5%E5%BF%97_%E7%AE%A1%E7%90%86%E5%90%8E%E5%8F%B0.md) - Admin panel issues (historical, Chinese)

## Contributing

Issues and pull requests are welcome.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contribution guide.

### Commit Convention
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Formatting
- `refactor:` Refactoring
- `test:` Tests
- `chore:` Build and tooling

## License

MIT License

## Contact

- GitHub: [Lushangtu123](https://github.com/Lushangtu123)
- Repository: [E-commerce-website](https://github.com/Lushangtu123/E-commerce-website)

---

## Important Notice

**This is a learning and demonstration project** that implements the core features of an e-commerce system.

### Production-Grade Features Implemented
- JWT authentication
- Hashed password storage
- SQL injection protection
- XSS protection
- Rate limiting
- Redis caching
- Docker deployment
- Complete error handling
- Audit logging

### Recommended Additions for Production
- HTTPS certificates
- A real payment provider
- SMS and order-notification email (password-reset email through Gmail SMTP or Resend already exists)
- Object storage
- CDN configuration
- Monitoring and alerting
- Backup and recovery
- Load balancing

---

**Last updated**: 7 October 2026 | **Version**: 3.0.0

## v3.0.0 Highlights (2025-11-03)

### New Features
- **Complete coupon system**
  - Customer: coupon centre, my coupons, claiming and using coupons
  - Admin: creating coupons, managing status
  - Three coupon types: spend-and-save, percentage discount, no minimum spend
  - Coupon states: pending, active, ended, disabled

- **Account centre**
  - Profile summary (blue gradient card)
  - Coupon section (prominent orange-red design)
  - Feature grid (six shortcuts)
  - Single entry point for customer features

- **Recommendations**
  - Personalised recommendations based on browsing history
  - Related products on the product details page
  - "You may also like" on the home page

- **Automatic order timeout handling**
  - Unpaid orders cancelled after 30 minutes
  - Order status management driven by a scheduled job

### Bug Fixes
- Fixed SQL query parameterisation (LIMIT/OFFSET)
- Fixed character encoding (end-to-end UTF-8)
- Fixed garbled coupon text
- Fixed incorrect frontend import paths
- Improved user experience and interface design

### Release Statistics
- Added code: 5,944 lines
- Added pages: 4
- Added APIs: 15+
- Added database tables: 4
- Updated documentation: 3,365 lines
