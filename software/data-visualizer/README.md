# OAS Data Visualizer

A Next.js app deployed on Vercel (using Neon PostgreSQL for the database) for visualizing OAS data.

## Environment setup

As this project depends on `dlflib-js`, which is used for parsing `.dlf` files, we need to use an npm workspace in order to deploy on Vercel. For local development, follow these steps:

```
npm install -g dotenv-cli vercel
cd <repo root>/software
npm install
```

## Run locally

Sync local .env.local file from Vercel:

```
vercel env pull
```

Run app:

```
npm run dev
```

Note: when running locally, the development branch DB on Neon is used.

## To make a DB schema change

Whenever the Prisma schema is modified, run:

```
npm run db:push
```

To run Prisma Studio for viewing data, run:

```
npm run db:studio
```
