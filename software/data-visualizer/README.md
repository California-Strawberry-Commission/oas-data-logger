# OAS Data Visualizer

A Next.js app deployed on Vercel (using Neon PostgreSQL for the database) for visualizing OAS data.

## Environment setup

As this project depends on `dlflib-js`, which is used for parsing `.dlf` files, we need to use an npm workspace in order to deploy on Vercel. For local development, follow these steps:

```
$ npm install -g dotenv-cli vercel
$ cd <repo root>/software
$ npm install
```

## Run locally

### Set up local PostgreSQL

1.  Install the PostgreSQL package:

        $ sudo apt update
        $ sudo apt install postgresql

2.  Connect to PostgreSQL:

        $ sudo -u postgres psql

3.  Then run:

        CREATE USER prisma_user WITH PASSWORD 'password';
        CREATE DATABASE prisma_db OWNER prisma_user;
        GRANT ALL PRIVILEGES ON DATABASE prisma_db TO prisma_user;
        ALTER USER prisma_user CREATEDB;
        \q

4.  Create a file called `.env.local` that contains the following line:

        DATABASE_URL="postgresql://prisma_user:password@localhost:5432/prisma_db"

5.  Sync the DB schema to the local PostgreSQL DB:

        $ npm run db:deploy

### Run the app

```
$ npm run dev
```

### View data

Run Prisma Studio for viewing data:

```
$ npm run db:studio
```

## Creating DB schema changes

When making any change to the Prisma schema in `schema.prisma`, first create a migration:

```
$ npm run db:migrate my_migration_name
```

Make sure to check in the generated files under the `prisma/migrations` directory to source control. Note that when Vercel picks up the commit, it will automatically apply the newly created migration (via `npm run vercel-build`).
