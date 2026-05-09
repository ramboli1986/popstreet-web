# PopStreet Web

Standalone web/admin console for PopStreet inventory.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Vercel

Use this repository root as the Vercel project root and add:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The Supabase database also needs the admin role migration applied.
