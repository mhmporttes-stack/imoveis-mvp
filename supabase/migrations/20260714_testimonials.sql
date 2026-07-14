create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_description text default '',
  testimonial_text text not null,
  media_type text not null default 'none'
    check (media_type in ('none', 'image', 'video_upload', 'video_url')),
  image_url text default '',
  image_storage_path text default '',
  video_url text default '',
  video_storage_path text default '',
  video_thumbnail_url text default '',
  video_thumbnail_storage_path text default '',
  display_order integer not null default 0,
  is_published boolean not null default true,
  authorization_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists testimonials_public_order_idx
  on public.testimonials (is_published, display_order, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists testimonials_set_updated_at on public.testimonials;

create trigger testimonials_set_updated_at
before update on public.testimonials
for each row
execute function public.set_updated_at();

alter table public.testimonials enable row level security;

drop policy if exists "Public can read published testimonials" on public.testimonials;

create policy "Public can read published testimonials"
on public.testimonials
for select
using (is_published = true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'testimonials',
  'testimonials',
  true,
  50000000,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read testimonial media" on storage.objects;

create policy "Public can read testimonial media"
on storage.objects
for select
using (bucket_id = 'testimonials');
