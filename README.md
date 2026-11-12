# ERPGO Frontend

The current frontend scope is the ERPGO sign-in experience.

## API configuration

Set `VITE_API_URL` to the Laravel backend origin before starting or building the frontend, for example:

```env
VITE_API_URL=http://localhost:8000
```

The frontend sends requests to the existing `/api/auth/login`, `/api/auth/user`, and `/api/auth/logout` endpoints. A URL ending in `/api` is also normalized to the backend origin. If `VITE_API_URL` is empty, the frontend uses the current origin; configure a same-origin proxy in that case.

The returned Sanctum bearer token is kept in `sessionStorage` for the current browser tab. Settings are requested only after a Secretary has authenticated, because the backend protects `/api/settings` with the Secretary role. Its `image_path` is resolved through Laravel's public `/storage/` URL; all other roles use the ERPGO fallback mark.

Role destinations are mapped for Secretary, Customer, and Supplier sign-ins, but portal pages are intentionally not part of this frontend scope yet.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
