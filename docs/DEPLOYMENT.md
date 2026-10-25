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
The hostname for the Supabase API is still to be chosen. Keep Studio/admin and
database ports private. Only the authenticated API gateway should be exposed over TLS.

- Generate deployment credentials in the platform's protected configuration. Never
  commit passwords, JWT signing secrets, service-role keys or database connection strings.
- Configure Auth `SITE_URL` and allowed magic-link redirects for
  `https://alouna.leveris.lt`. Configure SMTP delivery before relying on magic-link login.
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
