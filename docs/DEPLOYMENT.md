# Hosting on the existing VPS

The owner selected the existing Hostinger/Coolify VPS on 25 October 2026.
Both the web application and Supabase will run there. Pages/Netlify/Vercel are
superseded. The web hostname is **alouna.leveris.lt**.

## Web application

1. Create a separate Alouna project in Coolify, without changing other applications.
2. Add a public Git repository application for `https://github.com/LeVilius2/alouna`,
   branch `main`, build pack **Dockerfile**, repository root `/`, Dockerfile `/Dockerfile`.
3. Route `https://alouna.leveris.lt` to container port **80**. Let Coolify manage TLS.
4. Create an `A` record for `alouna` pointing to the verified current VPS address.
   Verify public DNS before requesting the certificate; do not copy an old server IP blindly.
5. Deploy the tested commit. `GET /healthz` must return 200. The nginx configuration
   serves `/editor` and `/navigate` through the SPA fallback and revalidates the PWA
   manifest/service worker. Hashed assets use long-lived caching.
6. Verify trusted HTTPS, HTTP-to-HTTPS redirection, all three application routes,
   `/healthz`, `/manifest.webmanifest`, `/sw.js`, and that the live assets match the build.

Local container check (requires Docker):

```sh
docker build -t alouna-web .
docker run --rm -p 8080:80 alouna-web
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/navigate
```

Build tools use Node 24 LTS and the pnpm version in `package.json`. Keep the Dockerfile
and package-manager pin aligned when updating. `pnpm install --frozen-lockfile` must
work in CI and in the container; never disable package age/integrity protections.

## Self-hosted Supabase (M2)

Use the official Supabase stack supported by Coolify, with persistent volumes for
Postgres and Storage. Check the VPS's available RAM, CPU, disk and existing workload
before provisioning; do not assume the free managed tier's resource requirements.
The web app proxies only Auth, REST and Realtime under
`https://alouna.leveris.lt/supabase`. Studio/admin and database ports stay private.
No separate public API hostname or DNS record is needed.

- Generate deployment credentials in the platform's protected configuration. Never
  commit passwords, JWT signing secrets, service-role keys or database connection strings.
- Configure Auth `SITE_URL=https://alouna.leveris.lt` and
  `API_EXTERNAL_URL=https://alouna.leveris.lt/supabase`. Disable public signup,
  anonymous and phone login. The owner selected email/password login after
  checking `taskwardly-research`; SMTP and magic links are superseded.
- Enable PostGIS, apply the M2 migration and RLS, and load the reviewed seed data.
- Add scheduled database/volume backups and verify restoration before using field data.
- Provide only `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY` to the web
  build. Vite embeds them in public assets, so never use a service-role key there.
- Auth, Realtime, RLS and offline synchronization must be verified against this
  self-hosted instance, rather than relying solely on managed Supabase behavior.

## M1 deployment (25 October 2026)

The web app is deployed at **https://alouna.leveris.lt** in the Coolify project
**Alouna**, application **Alouna web**. The container healthcheck uses port 80 and
`/healthz`. Hostinger's `alouna` A record points to the verified VPS address with
TTL 60. Deployments are **manual** in Coolify; GitHub pushes run CI. No deployment
webhook or additional credentials were created.

The M1 release passed lint, typecheck, 36 tests and the production build, including
GitHub CI. Public probes verified TLS trust, HTTP-to-HTTPS redirection, health,
the `/`, `/editor`, `/navigate` SPA routes, PWA files and exact local/live asset hashes.
The browser renders the app shell and placeholder routes. The navigator/editor
features and field validation remain later milestones. **Supabase is not provisioned
yet**; its self-hosted schema/data layer is next (M2).

## M2 configuration

Use Coolify's supported Supabase compose bundle as one tested set. Its component
images are pinned by the maintained bundle; do not update individual images
blindly. Application dependencies remain at their latest policy-eligible stable
releases (`pnpm -r outdated`). The current bundle's database is PostgreSQL 15;
the SQL contract is also tested against PostgreSQL 17/PostGIS in CI. Plan a tested
bundle/database-major upgrade separately from npm package updates.

In the Supabase source Compose:

- Set GoTrue signup disabled, email/password enabled, anonymous/phone login
  disabled and email autoconfirm disabled. Admin-created accounts use explicit
  `email_confirm=true` and do not send an email.
- Use the same-origin URLs above as literals. Remove the generated
  `SERVICE_URL_SUPABASEKONG_8000` declaration and replace the other
  `${SERVICE_URL_SUPABASEKONG}` references with the same-origin API URL, otherwise
  Coolify regenerates a public gateway domain when parsing the template.
- Add only `supabase-kong` to the existing external `coolify` network. Keep every
  other service on the stack's private network. Remove the generated Kong domain
  and verify that Domains shows **No domains configured** before deploying.
- Do not publish host ports for PostgreSQL, Studio, MinIO or the pooler.

Web Coolify environment:

```dotenv
# Build-time, public:
VITE_SUPABASE_URL=https://alouna.leveris.lt/supabase
VITE_SUPABASE_ANON_KEY=the-platform-generated-public-anon-key
# Runtime, private Docker upstream (replace the service UUID):
ALOUNA_SUPABASE_UPSTREAM=supabase-kong-SERVICE_UUID:8000
```

nginx uses a runtime DNS lookup to survive container replacement. Its route
allowlist rejects Studio, metadata and all other gateway paths. Workbox excludes
API navigations from the SPA fallback and never caches Auth/API responses.

Apply the migration and generated seed using `docker exec -i supabase-db-SERVICE_UUID
psql -U postgres -d postgres -v ON_ERROR_STOP=1`, with each file on stdin. The SQL
permission test can then run against the new instance: its fixtures roll back.
Do not run `bootstrap.sql` or the CI-only concurrent test on the instance.

Create the first administrator from a private server terminal:

```sh
python3 scripts/create-member.py --stack SERVICE_UUID --email OWNER_EMAIL --role admin
```

The owner enters and repeats the password in the hidden terminal prompt. The
helper uses the private GoTrue Admin API and writes the profile only after Auth
creation succeeds. It never puts the password in argv, environment, shell history
or output. Add walkers using `--role walker`; use `--reset-password` with the
intended role for an explicit administrator password reset. No service key is
copied out of the VPS or embedded in browser assets. Never enable public signup
as an account-bootstrap shortcut.

The full backup script `scripts/backup-database.sh` runs as root at **01:00 UTC
daily**, retaining **14 copies / 14 days / 2 GB** under
`/data/coolify/backups/alouna` (directory 0700, files 0600). It uses an atomic
rename, verifies the dump catalog, writes SHA-256 checksums and serializes runs
with `flock`. Each dump has a `.graphql.sql` companion containing Supabase's
generated GraphQL wrapper (its grants are dumped without its definition), plus
checksums for both files. Keep all companion files with the dump. Cron writes success/failure output to `/root/alouna-ops/backup.log`.
Check that log and backup timestamps during operations; an external failure
notification channel is not configured.

Coolify's default native `pg_dump` uses `--no-acl --no-owner`. Its initial backup
restored the rows but failed permission verification, so that schedule is disabled.
The replacement includes the original owners and grants. To test a new backup,
run `scripts/verify-restore.sh SERVICE_UUID DUMP_PATH alouna_m2_restore_verify`.
It creates a separate database from `template0`, restores the archive while
deferring only the generated GraphQL wrapper grants, then applies that wrapper
with its exact ownership/grants and runs the SQL access checks.
Remove only that disposable database after the checks pass. Never restore over the live database as a test. A new VPS must first
initialize the same Supabase bundle's system roles/extensions.

Local backups protect against accidental data changes; they share the VPS failure
domain. No validated remote S3 destination was configured during this setup.
Keep an encrypted copy of the protected Coolify stack configuration/JWT secrets
alongside any operator-managed off-site backup. Storage uploads are not used in
M2; add object-storage backups before introducing uploaded media.

## M2 verification (25 October 2026)

The self-hosted bundle is healthy in **Alouna Supabase**. A confirmed administrator
account was created through the private helper and the owner signed in personally.
The live `/editor` panel loaded the six approved features, role and cache version.
The imported self-intersecting neighbour remains quarantined.

Chrome reloaded `/editor` with per-tab network requests blocked; protocol events
reported `ERR_INTERNET_DISCONNECTED`, while the feature list and cached version 26
remained available. Restoring normal connectivity and syncing refreshed the cache
time. Temporary network emulation was removed. This establishes desktop browser
cache behavior; primary-device Safari field testing remains M8.

External probes confirmed trusted HTTPS, correct PWA manifest MIME, exact
local/live frontend asset hashes, anonymous map/rule reads denied (401), and 404s
for Studio and Auth administration/invitation routes. The release passed lint,
typecheck, 48 tests, deterministic seed verification, build and PostgreSQL
ownership/review/idempotency/concurrency checks in CI. The production build has a
non-blocking chunk-size warning; bundle splitting can be addressed with later UI
work.

The complete backup was restored into a separate database with original owners,
permission grants and generated GraphQL wrapper. The SQL access tests passed
against that restored copy, which was then removed. The owner account was backed
up after creation. The full root cron job is active on the UTC VPS; obsolete trial
archives are separated under `failed-restore-tests`. Backups remain VPS-local.
