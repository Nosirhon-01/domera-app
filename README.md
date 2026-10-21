# DOMERA Backend — Centralized API

Production-ready, secure, scalable, and modular NestJS backend for **DOMERA** (Commercial Real Estate & Property Platform).

This backend serves as the single centralized API for:
- Flutter Mobile Application
- Web Application
- Admin Panel
- Telegram Bot
- Internal services & Third-party integrations

---

## 🛠 Technology Stack

- **Framework**: Node.js & NestJS (v10)
- **Language**: TypeScript
- **Database**: PostgreSQL 16
- **ORM**: Prisma ORM
- **Authentication**: JWT Access Token + Refresh Token (Hashed, Rotation, Revocation)
- **Password Hashing**: `bcryptjs`
- **Validation**: `class-validator` & `class-transformer`
- **Security**: Helmet, CORS, Environment Validation, RBAC Guards, Rate Limiting
- **API Documentation**: Swagger / OpenAPI (`/api/docs`)
- **Containerization**: Docker & Docker Compose

---

## 📁 Architecture & Directory Structure

```text
src/
├── auth/                 # Authentication (Register, Login, Token Refresh, Logout, /auth/me)
├── users/                # User management, Roles (USER, ADMIN, MANAGER, AGENT)
├── properties/           # Commercial real estate listings CRUD & search filters
├── property-images/      # Property image management & primary image selection
├── favorites/            # User property bookmarks/favorites
├── uploads/              # Modular storage abstraction layer (Local disk, AWS S3/Cloudflare R2 ready)
├── health/               # Application & PostgreSQL database ping health check
├── common/               # Global interceptors, filters, guards, decorators & pagination DTOs
├── config/               # Environment loader & schema validation
├── prisma/               # PrismaClient database connection module
├── app.module.ts         # Main root module
└── main.ts               # Application entry point with Swagger, Helmet, CORS, and Pipes
```

---

## 🚀 Quick Start & Installation

### 1. Requirements
- Node.js >= 20.x
- npm >= 10.x
- PostgreSQL database or Docker

### 2. Environment Setup
Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure your `.env` variables:
```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/domera_db?schema=public
JWT_ACCESS_SECRET=your_super_secret_access_key
JWT_REFRESH_SECRET=your_super_secret_refresh_key
ADMIN_EMAIL=admin@domera.com
ADMIN_PASSWORD=AdminPassword123!
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup & Migration
Generate Prisma Client and run database migrations:
```bash
npm run prisma:generate
npm run prisma:migrate
```

### 5. Seed Initial Admin User
```bash
npm run prisma:seed
```

---

## 💻 Running the Application

### Development Mode
```bash
npm run start:dev
```

### Production Build & Run
```bash
npm run build
npm run start:prod
```

---

## 🐳 Docker Deployment

### Start PostgreSQL & Backend with Docker Compose
```bash
docker-compose up -d --build
```
This will start PostgreSQL 16 (bound to `127.0.0.1:5432`), the NestJS backend on port `3000`, and Caddy (HTTPS) on ports `80`/`443`.

On startup the backend container runs `prisma db push`, so new tables/columns are created automatically after each deploy (set `DB_SYNC_ON_START=false` to skip).

### HTTPS
1. Point a domain's DNS A record (e.g. `api.domera.uz`) to the server and open ports 80 and 443.
2. Deploy with the domain set:
   ```bash
   DOMAIN=api.domera.uz docker-compose up -d --build
   ```
3. Caddy issues and renews the Let's Encrypt certificate automatically. The API is then at `https://api.domera.uz/api`.

---

## 📖 Swagger / OpenAPI Documentation

Interactive Swagger API documentation is available at:

```
http://localhost:3000/api/docs
```

### Authentication in Swagger:
1. Register (`POST /api/auth/register`) or Login (`POST /api/auth/login`).
2. Copy the returned `accessToken`.
3. Click the **Authorize** button in Swagger UI and enter: `Bearer <your_access_token>`.

---

## 📱 Flutter Mobile App Integration Guide

The DOMERA Flutter application interacts with this backend exclusively over HTTPS REST APIs.

### Base URL
```text
https://<your-domain>/api
```
(`http://<server-ip>:3000/api` still works for older builds.)

### Key Flutter Endpoints
- `POST /api/auth/register` — Create user account
- `POST /api/auth/login` — Login with Email OR Phone Number
- `POST /api/auth/refresh` — Exchange refresh token for new access token
- `POST /api/auth/logout` — Revoke session
- `GET /api/auth/me` — Fetch logged in user profile
- `GET /api/properties` — Fetch paginated commercial properties with search filters
- `GET /api/properties?minLat=&maxLat=&minLng=&maxLng=` — Properties inside the visible map area (`hasLocation=true` for all with coordinates)
- `DELETE /api/properties/:propertyId/images/:imageId` — Delete a property image (image `id` comes from `images[]` in the property response)
- `POST /api/favorites/:propertyId` — Save property to favorites
- `PATCH /api/conversations/:id/read` — Mark all messages in a conversation as read
- `PATCH /api/messages/:id/read` — Mark a single message as read
- `POST /api/devices` — Register the FCM token (`{ token, platform: ANDROID | IOS | WEB }`) after login and on token refresh
- `DELETE /api/devices` — Unregister the FCM token (`{ token }`) on logout

---

## 🔔 Push Notifications (FCM)

1. Firebase Console → Project settings → Service accounts → **Generate new private key**.
2. Give the JSON to the backend (never commit it):
   - locally: `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` in `.env`
   - Docker: `FIREBASE_SERVICE_ACCOUNT_BASE64=$(base64 -w0 firebase-service-account.json) docker-compose up -d --build`
3. Without these the backend runs normally and only skips sending pushes.

Pushes sent:
| Event | `data.type` | Other `data` keys |
|---|---|---|
| New chat message | `new_message` | `conversationId`, `messageId`, `senderId` |

Invalid / expired tokens are removed automatically.

---

## 🔒 Security Best Practices
- Passwords are strictly hashed using `bcrypt` (10 rounds).
- Refresh tokens are hashed before storing in database (`RefreshToken` model).
- Role-based authorization (`@Roles(Role.ADMIN)`) blocks unauthorized route access.
- ValidationPipe auto-sanitizes input body and rejects unknown properties.

---

## 🧪 Testing

```bash
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
```
