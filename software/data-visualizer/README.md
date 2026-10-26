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

### Pull env variables

```
$ cd <repo root>/software/data-visualizer
$ vercel link
$ vercel env pull .env.local --environment=development
$ vercel env pull .env.preview --environment=preview
$ vercel env pull .env.prod --environment=production
```

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

4.  Check that `.env.local` contains the following line:

        DATABASE_URL="postgresql://prisma_user:password@localhost:5432/prisma_db"

5.  Sync the DB schema to the local PostgreSQL DB:

        $ npm run db:deploy

6.  (Optional) Seed the DB with an ADMIN user:

        $ npm run db:seed:local

### Run the app

```
$ npm run dev
```

### View data

Run Prisma Studio for viewing data:

```
$ npm run db:studio
```

### Clear data

Reset the DB

```
$ npm run db:reset
```

Apply migrations to the DB

```
$ npm run db:deploy
```

### Example API requests

Headers x-device-id and x-dev-key are required for endpoints that require device auth. Also, note that the run UUID must be formatted properly in the standard UUID format.

For example, to upload run data:

```
curl -X POST http://localhost:3000/api/upload/00000000-0000-0000-0000-000000000000 -H "x-device-id: <your device ID> -H "x-dev-key: <your dev key>" -F "files=@/path/to/meta.dlf" -F "files=@/path/to/polled.dlf" -F "files=@/path/to/event.dlf" -F "isActive=false"
```

Headers x-dev-user-email and x-dev-key are required for endpoints that require user auth.

For example, to get a list of devices:

```
curl -X GET http://localhost:3000/api/devices -H "x-dev-user-email: admin@example.com" -H "x-dev-key: <your dev key>"
```

## Making DB schema changes

After making any changes to the Prisma schema in `schema.prisma`, create a migration:

```
$ npm run db:migrate my_migration_name
```

Make sure to check in the generated files under the `prisma/migrations` directory to source control. Note that when Vercel picks up the commit, it will automatically apply the newly created migration (via `npm run vercel-build`).

## Provisioning devices

Run the following script to provision a device and update the DB in interactive mode (connects via Serial, waits for the device to announce its ID, generates a secret, saves it to the DB, and pushes it to the device):

```
npm run provision-device -- <serial port, such as /dev/ttyACM0>
```

Run the following script for DB-only mode (manually inserts a known device ID and secret into the database):

```
npm run provision-device -- --db-only --id=<device ID> --secret=<device secret> --env=<local|preview|prod>
```

## Pushing OTA firmware

Requires [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (`pio`) and, for preview/prod, the [GitHub CLI](https://cli.github.com/) (`gh`, authenticated via `gh auth login`).

If PlatformIO was installed via the VS Code extension, `pio` is not on `PATH` outside of VS Code's PlatformIO terminal. Symlink it into a directory on `PATH`:

```
mkdir -p ~/.local/bin
ln -s ~/.platformio/penv/bin/pio ~/.local/bin/pio
ln -s ~/.platformio/penv/bin/platformio ~/.local/bin/platformio
```

Make sure `~/.local/bin` is on your `PATH`, then verify with `pio --version`.

Run the following script to release firmware to an env. Each release uploads the .bin and .elf to the env's S3 bucket and adds a FirmwareRelease row to the env's DB. If `--deviceType` is omitted, both V0 and V1 are released.

```
npm run release-firmware -- --env <local|preview|prod> --version <x.y.z> [--deviceType <V0|V1>] [--channel <STABLE|BETA>] [--ref <git ref>] [--publish] [--dry-run]
```

- **local**: Builds the current working tree (including uncommitted changes), or `--ref` if given. The version is `<x.y.z>-dev.<shortsha>[.dirty]`. GitHub is not touched.
- **preview**: Builds `--ref` (default `HEAD`, which must be pushed) in a clean worktree, with the next build number in the preview DB. The version is `x.y.z` for STABLE, or `x.y.z-beta.N` for BETA, where N increments based on existing tags. Creates the GitHub release `firmware/v<version>` (a pre-release for BETA) with the .bin files `firmware-v<version>-rev<0|1>.bin`. Fails if `firmware/vx.y.z` already exists.
- **prod**: Promotes an existing GitHub release. `--version` is the full version (e.g. `0.0.2` or `0.0.2-beta.3`), and the channel follows from it. The .bin files are downloaded from the GitHub release and verified against the preview DB. The .elf files come from the preview S3 bucket, and the build numbers come from the preview DB, since they are baked into the .bin files. Requires `.env.preview` as well as `.env.prod`.

### Publishing, unpublishing, and republishing a release

Devices only pick up published releases. Releases created without `--publish` start out unpublished. A release is identified by `{deviceType, channel, buildNumber}` within an env.

To view a release's current state (no changes are made):

```
npm run update-firmware -- --env <local|preview|prod> --deviceType <V0|V1> --channel <STABLE|BETA> --buildNumber <build number>
```

To publish a release, or republish one that was previously unpublished:

```
npm run update-firmware -- --env <local|preview|prod> --deviceType <V0|V1> --channel <STABLE|BETA> --buildNumber <build number> --publish
```

To unpublish a release:

```
npm run update-firmware -- --env <local|preview|prod> --deviceType <V0|V1> --channel <STABLE|BETA> --buildNumber <build number> --unpublish
```

Notes:

- `--channel` defaults to `STABLE`.
- Only the env's DB is changed. The .bin/.elf stay in S3 and the GitHub release is left as is, so an unpublished release can be republished at any time.
- Devices are offered the published release with the highest build number. Unpublishing the latest release makes the previous published release the latest again, but devices that already installed the unpublished build won't downgrade. To roll those devices back, release a new build with the fix (or the old code).
