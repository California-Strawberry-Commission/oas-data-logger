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

### Option 2: Set up SQLite

This option is simpler for Windows developers using Git Bash and avoids PostgreSQL installation complexity.

#### Prerequisites
- Node.js installed
- Git Bash (comes with Git for Windows)

#### Step-by-step setup

1. **Navigate to the data-visualizer directory:**
   ```bash
   cd /path/to/your/oas-data-logger/software/data-visualizer
   ```

2. **Create the `.env.local` file with SQLite configuration:**
   ```bash
   echo 'DATABASE_URL="file:./dev.db"' > .env.local
   ```

3. **Modify Prisma schema for SQLite:**
   
   Edit `prisma/schema.prisma` and change the datasource provider:
   ```prisma
   datasource db {
     provider = "sqlite"  // Change from "postgresql" to "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

4. **Generate Prisma client and create database:**
   ```bash
   # Generate the Prisma client
   npm run db:generate
   
   # Create a new migration for SQLite
   npx dotenv -e .env.local -- npx prisma migrate dev --name init_sqlite
   ```

### Run the app

```bash
$ npm run dev
```

The server will start at `http://localhost:3000`

### View data

Run Prisma Studio for viewing data:

```bash
$ npm run db:studio
```

This will open at `http://localhost:5555` where you can inspect your database.

## Testing uploads locally

### Configure ESP32 for local uploads

1. **Find your computer's local IP address:**
   ```bash
   # Windows (Git Bash)
   ipconfig | grep -A 10 "Wireless LAN adapter Wi-Fi" | grep "IPv4"
   
   # Or use
   ipconfig
   # Look for IPv4 Address under your active network adapter
   ```

2. **Update ESP32 code (`main.cpp`):**
   ```cpp
   // Change from:
   const char* UPLOAD_HOST{"oas-data-logger.vercel.app"};
   const uint16_t UPLOAD_PORT{443};
   
   // To:
   const char* UPLOAD_HOST{"192.168.1.XXX"};  // Your computer's local IP
   const uint16_t UPLOAD_PORT{3000};
   ```

3. **Disable HTTPS for local testing in `uploader_component.cpp`:**
   ```cpp
   // Change from:
   WiFiClientSecure client;
   client.setInsecure();
   
   // To:
   WiFiClient client;  // Use non-secure client for local testing
   ```

### Manual upload testing

Test the upload endpoint manually using curl:

```bash
# Create test files
echo "test" > meta.dlf
echo "test" > event.dlf
echo "test" > polled.dlf

# Test upload
curl -X POST \
  -F "files=@meta.dlf" \
  -F "files=@event.dlf" \
  -F "files=@polled.dlf" \
  http://localhost:3000/api/upload/test-uuid-1234
```

## Creating DB schema changes

When making any change to the Prisma schema in `schema.prisma`, first create a migration:

```bash
$ npm run db:migrate my_migration_name
```

Make sure to check in the generated files under the `prisma/migrations` directory to source control. Note that when Vercel picks up the commit, it will automatically apply the newly created migration (via `npm run vercel-build`).

## Troubleshooting

### Common Windows issues

1. **Port 3000 already in use:**
   ```bash
   # Find process using port 3000
   netstat -ano | findstr :3000
   
   # Kill the process (replace PID_NUMBER with actual PID)
   taskkill //PID PID_NUMBER //F
   ```

2. **SQLite database locked error:**
   - Close Prisma Studio before running migrations or the app
   - Make sure no other process is accessing the database file

3. **Module not found errors:**
   ```bash
   # Clean install
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **Migration lock error when switching from PostgreSQL to SQLite:**
   ```bash
   # Remove existing migrations
   rm -rf prisma/migrations
   
   # Then create new SQLite migrations
   npx dotenv -e .env.local -- npx prisma migrate dev --name init_sqlite
   ```

### Debugging upload issues

1. **Monitor server logs:**
   The Next.js dev server will show all incoming requests and errors in the terminal.

2. **Check database contents:**
   Use Prisma Studio (`npm run db:studio`) to see if uploads are being received and stored correctly.

3. **Add debug logging:**
   Edit `app/api/upload/[uuid]/route.ts` to add console.log statements for debugging.

4. **Verify file requirements:**
   The server expects exactly 3 files: `meta.dlf`, `event.dlf`, and `polled.dlf`


