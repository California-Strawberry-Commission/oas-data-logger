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

### Environment setup

Requires [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (`pio`) and, for preview/prod, the [GitHub CLI](https://cli.github.com/) (`gh`, authenticated via `gh auth login`).

If PlatformIO was installed via the VS Code extension, `pio` is not on `PATH` outside of VS Code's PlatformIO terminal. Symlink it into a directory on `PATH`:

```
mkdir -p ~/.local/bin
ln -s ~/.platformio/penv/bin/pio ~/.local/bin/pio
ln -s ~/.platformio/penv/bin/platformio ~/.local/bin/platformio
```

Make sure `~/.local/bin` is on your `PATH`, then verify with `pio --version`.

### OTA channels

Each release is marked as STABLE or BETA (`--channel`). Each device is subscribed to a channel:

- Devices by default are subscribed to the **STABLE** channel, and receive the latest published STABLE release.
- Devices subscribed to the **BETA** channel receive the latest published release on either channel.

Build numbers are shared across channels (per device type), so "latest" is simply the highest build number.

### Release workflow

Every release is first built and released to preview, which creates the GitHub release. After testing, that same GitHub release is promoted to prod, so prod devices get the same binaries that were tested on preview.

Example: releasing v0.0.3, with a beta round first.

```
# 1. (Optional) Test the working tree on a local setup
npm run release-firmware -- --env local --version 0.0.3 --publish

# 2. Push the commit, then cut a beta on preview from it.
#    Creates the GitHub pre-release firmware/v0.0.3-beta.1 with the V0 and V1 .bins
npm run release-firmware -- --env preview --channel BETA --version 0.0.3 --ref <git hash> --publish

#    Fix any issues found, then push, and cut another beta.
#    Creates the GitHub pre-release firmware/v0.0.3-beta.2 with the V0 and V1 .bins
npm run release-firmware -- --env preview --channel BETA --version 0.0.3 --ref <new git hash> --publish

# 3. (Optional) Promote the beta to prod devices on the BETA channel
npm run release-firmware -- --env prod --version 0.0.3-beta.2 --publish

# 4. Cut the stable release on preview. Creates the GitHub release firmware/v0.0.3
npm run release-firmware -- --env preview --channel STABLE --version 0.0.3 --ref <git hash> --publish

# 5. After verifying on preview devices, promote it to prod devices on the STABLE channel
npm run release-firmware -- --env prod --version 0.0.3 --publish
```

Note that once `firmware/v0.0.3` exists, no more betas or stable releases of 0.0.3 can be created. For the next release, the version needs to be bumped. To stage a release without devices picking it up yet, omit `--publish` and publish it later with `update-firmware` (see below). Use `--dry-run` to build (or, for prod, download and verify) without touching GitHub, S3, or the DB.

#### `release-firmware` reference

Each release uploads the .bin and .elf to the env's S3 bucket and adds a FirmwareRelease row to the env's DB. If `--deviceType` is omitted, both V0 and V1 are released.

```
npm run release-firmware -- --env <local|preview|prod> --version <x.y.z> [--deviceType <V0|V1>] [--channel <STABLE|BETA>] [--ref <git ref>] [--publish] [--dry-run]
```

- **local**: Builds the current working tree (including uncommitted changes), or `--ref` if given. The version is `<x.y.z>-dev.<shortsha>[.dirty]`. GitHub is not touched.
- **preview**: Builds `--ref` (default `HEAD`, which must be pushed) in a clean worktree, with the next build number in the preview DB. The version is `x.y.z` for STABLE, or `x.y.z-beta.N` for BETA, where N increments based on existing tags. Creates the GitHub release `firmware/v<version>` (a pre-release for BETA) with the .bin files `firmware-v<version>-rev<0|1>.bin`. Fails if `firmware/vx.y.z` already exists.
- **prod**: Promotes an existing GitHub release. `--version` is the full version (e.g. `0.0.2` or `0.0.2-beta.3`), and the channel follows from it. The .bin files are downloaded from the GitHub release and verified against the preview DB. The .elf files come from the preview S3 bucket, and the build numbers come from the preview DB, since they are baked into the .bin files. Requires `.env.preview` as well as `.env.prod`.

### Publishing, unpublishing, and republishing a release

Devices only pick up published releases. Releases created without `--publish` start out unpublished. A release is identified by `{deviceType, buildNumber}` within an env.

To view a release's current state (no changes are made):

```
npm run update-firmware -- --env <local|preview|prod> --deviceType <V0|V1> --buildNumber <build number>
```

To publish a release, or republish one that was previously unpublished:

```
npm run update-firmware -- --env <local|preview|prod> --deviceType <V0|V1> --buildNumber <build number> --publish
```

To unpublish a release:

```
npm run update-firmware -- --env <local|preview|prod> --deviceType <V0|V1> --buildNumber <build number> --unpublish
```

Notes:

- Only the env's DB is changed. The .bin/.elf stay in S3 and the GitHub release is left as is, so an unpublished release can be republished at any time.
- Devices are offered the published release with the highest build number on the channels they receive (see [OTA channels](#ota-channels)). Unpublishing the latest release makes the previous published release the latest again, but devices that already installed the unpublished build won't downgrade. To roll those devices back, release a new build with the fix (or the old code).
