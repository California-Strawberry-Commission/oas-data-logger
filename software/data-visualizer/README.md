# OAS Data Visualizer

A Next.js app deployed on Vercel for visualizing OAS data.

## Environment setup

```
npm install -g dotenv-cli
cd data-visualizer
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

## To make a DB schema change

The recommended workflow with using Prisma alongside PlanetScale is to use
`prisma db push` instead of `prisma migrate`.

```
npm run db:push
```

To run Prisma Studio for viewing data, run:

```
npm run db:studio
```
