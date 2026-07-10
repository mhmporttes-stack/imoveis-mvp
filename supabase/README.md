# Supabase

1. Crie um projeto no Supabase.
2. Abra SQL Editor e rode `supabase/schema.sql`.
3. Copie Project URL e anon public key para a Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Copie a service role key para a Vercel:
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Rode um novo deploy.

O site publico usa leitura anonima apenas para empreendimentos publicados.
O painel administrativo usa a service role key somente no servidor.

