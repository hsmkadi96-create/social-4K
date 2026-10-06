# Patcher SaaS starter

A production-oriented monorepo for a subscription video-processing SaaS. It includes Next.js customer/admin UI, NestJS API, PostgreSQL/Prisma, Redis/BullMQ worker, and S3-compatible storage.

## Requirements
Node 22+, Docker, Docker Compose.

## Run
1. `cp .env.example .env`
2. `docker compose up -d`
3. `npm install`
4. `npm run db:generate`
5. `npm run db:migrate`
6. `npm run db:seed`
7. Run API, worker and web in separate terminals with the workspace dev commands.

API: http://localhost:4000
Web: http://localhost:3000
MinIO console: http://localhost:9001

The processing worker uses FFmpeg when available. Replace `processVideo()` with your own lawful media transformation pipeline. Never rely on client-side subscription checks; the API enforces plan limits server-side.
