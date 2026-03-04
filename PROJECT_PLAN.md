# Backend Plan - NestJS + Prisma + PostgreSQL

## Tech Stack

- **Framework**: NestJS (Node.js)
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Language**: TypeScript
- **Auth**: JWT (access token + refresh token)
- **Validation**: class-validator, class-transformer
- **Docs**: Swagger (OpenAPI)

---

## Cấu trúc thư mục

```
backend/
├── prisma/
│   ├── schema.prisma          # Định nghĩa models & database
│   └── migrations/            # Auto-generated migration files
│
├── src/
│   ├── main.ts                # Entry point - khởi động app
│   ├── app.module.ts          # Root module
│   ├── app.controller.ts      # Root controller (health check)
│   ├── app.service.ts         # Root service
│   │
│   ├── common/                # Shared utilities
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts   # Lấy user từ request
│   │   │   └── roles.decorator.ts          # Gán role cho route
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts    # Xử lý lỗi toàn cục
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts           # Bảo vệ route bằng JWT
│   │   │   └── roles.guard.ts              # Kiểm tra quyền truy cập
│   │   ├── interceptors/
│   │   │   └── response.interceptor.ts     # Chuẩn hóa response
│   │   └── pipes/
│   │       └── validation.pipe.ts          # Validate DTO input
│   │
│   ├── config/                # Cấu hình ứng dụng
│   │   ├── app.config.ts      # App config (port, env...)
│   │   └── database.config.ts # Database config
│   │
│   ├── prisma/                # Prisma module
│   │   ├── prisma.module.ts   # Cung cấp PrismaService toàn cục
│   │   └── prisma.service.ts  # Wrapper PrismaClient, lifecycle hooks
│   │
│   ├── auth/                  # Authentication module
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts # POST /auth/register, /auth/login, /auth/refresh, /auth/logout
│   │   ├── auth.service.ts    # Logic đăng ký, đăng nhập, refresh token
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts          # Xác thực access token
│   │   │   └── jwt-refresh.strategy.ts  # Xác thực refresh token
│   │   └── dto/
│   │       ├── register.dto.ts
│   │       ├── login.dto.ts
│   │       └── token.dto.ts
│   │
│   └── users/                 # Users module (ví dụ feature module)
│       ├── users.module.ts
│       ├── users.controller.ts # GET /users, GET /users/:id, PATCH /users/:id, DELETE /users/:id
│       ├── users.service.ts
│       └── dto/
│           ├── create-user.dto.ts
│           └── update-user.dto.ts
│
├── test/
│   ├── app.e2e-spec.ts        # E2E tests
│   └── jest-e2e.json
│
├── .env                       # Biến môi trường (KHÔNG commit)
├── .env.example               # Mẫu biến môi trường
├── .gitignore
├── .eslintrc.js
├── .prettierrc
├── nest-cli.json
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

---

## Chi tiết các file cần tạo

### 1. `.env` / `.env.example`

```env
DATABASE_URL_DEV="postgresql://USER:PASSWORD@localhost:5432/vocabrender_db?schema=public"

JWT_ACCESS_SECRET=your_access_secret_key
JWT_ACCESS_EXPIRES_IN=15m

JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_REFRESH_EXPIRES_IN=7d

PORT=3000
NODE_ENV=development
```

---

### 2. `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL_DEV")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  username     String   @unique
  passwordHash String
  role         Role     @default(USER)
  refreshToken String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("users")
}

enum Role {
  USER
  ADMIN
}
```

---

### 3. `src/main.ts`

- Khởi tạo NestJS app
- Bật ValidationPipe toàn cục
- Cấu hình Swagger
- Cấu hình CORS
- Lắng nghe trên PORT từ `.env`

---

### 4. `src/app.module.ts`

- Import ConfigModule (global: true) để đọc `.env`
- Import PrismaModule (global: true)
- Import AuthModule
- Import UsersModule

---

### 5. `src/prisma/prisma.service.ts`

- Extend `PrismaClient`
- Implement `OnModuleInit`: gọi `this.$connect()`
- Implement `OnModuleDestroy`: gọi `this.$disconnect()`

---

### 6. `src/auth/auth.service.ts`

- `register(dto)`: hash password bằng bcrypt, tạo user trong DB
- `login(dto)`: verify password, tạo access + refresh token
- `refreshTokens(userId, refreshToken)`: verify refresh token, cấp token mới
- `logout(userId)`: xóa refresh token trong DB

---

### 7. `src/auth/strategies/jwt.strategy.ts`

- Đọc Bearer token từ Authorization header
- Verify với `JWT_ACCESS_SECRET`
- Trả về payload (userId, email, role)

---

### 8. `src/common/interceptors/response.interceptor.ts`

- Chuẩn hóa tất cả response về dạng:

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-03-03T00:00:00.000Z"
}
```

---

### 9. `src/common/filters/http-exception.filter.ts`

- Bắt tất cả HttpException
- Trả về dạng chuẩn:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Bad Request",
  "timestamp": "2026-03-03T00:00:00.000Z"
}
```

---

## API Endpoints

| Method | Endpoint       | Mô tả                       | Auth        |
| ------ | -------------- | --------------------------- | ----------- |
| POST   | /auth/register | Đăng ký tài khoản           | ❌          |
| POST   | /auth/login    | Đăng nhập, nhận tokens      | ❌          |
| POST   | /auth/refresh  | Làm mới access token        | JWT Refresh |
| POST   | /auth/logout   | Đăng xuất                   | JWT         |
| GET    | /users         | Lấy danh sách users (admin) | JWT + ADMIN |
| GET    | /users/:id     | Lấy thông tin user          | JWT         |
| PATCH  | /users/:id     | Cập nhật user               | JWT         |
| DELETE | /users/:id     | Xóa user                    | JWT + ADMIN |
| GET    | /              | Health check                | ❌          |

---

## Các bước khởi tạo dự án

```bash
# 1. Cài NestJS CLI và khởi tạo project
npm i -g @nestjs/cli
nest new backend --package-manager npm

# 2. Cài các dependencies cần thiết
npm install @prisma/client @nestjs/config @nestjs/jwt @nestjs/passport
npm install passport passport-jwt bcrypt class-validator class-transformer
npm install @nestjs/swagger swagger-ui-express

# 3. Cài dev dependencies
npm install -D prisma @types/passport-jwt @types/bcrypt

# 4. Khởi tạo Prisma
npx prisma init

# 5. Sau khi viết schema, tạo migration đầu tiên
npx prisma migrate dev --name init

# 6. Generate Prisma Client
npx prisma generate

# 7. Chạy development server
npm run start:dev
```

---

## Thứ tự tạo file (khuyến nghị)

1. `.env` + `.env.example`
2. `prisma/schema.prisma` → chạy migrate
3. `src/prisma/prisma.service.ts` + `prisma.module.ts`
4. `src/app.module.ts` + `src/main.ts`
5. `src/common/filters/http-exception.filter.ts`
6. `src/common/interceptors/response.interceptor.ts`
7. `src/common/guards/jwt-auth.guard.ts` + `roles.guard.ts`
8. `src/common/decorators/`
9. `src/auth/` (strategies → dto → service → controller → module)
10. `src/users/` (dto → service → controller → module)
