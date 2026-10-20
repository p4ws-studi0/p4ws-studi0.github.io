-- Schema only. Confidential page content is imported from an OUTSIDE-repo bundle.
-- This migration does not change Auth settings, sessions, users, or approvals.
begin;

create table if not exists public.hq_knowledge_pages (
  path text primary key,
  title text not null,
  category text not null,
  html_content text not null,
  search_text text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  is_archive boolean not null default false,
  page_kind text not null check (page_kind in ('article', 'index')),
  updated_at timestamptz not null default statement_timestamp(),
  constraint hq_knowledge_path_valid check (
    (path like '/kb/%' or path like '/kb copy/%' or path like '/not_in_use 10.39.45 PM/%')
    and position(chr(92) in path) = 0
    and path !~ '[[:cntrl:]]'
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '\.html$'
  )
);

alter table public.hq_knowledge_pages enable row level security;
alter table public.hq_knowledge_pages force row level security;
revoke all on table public.hq_knowledge_pages from public, anon, authenticated;
grant select on table public.hq_knowledge_pages to authenticated;
grant all on table public.hq_knowledge_pages to service_role;

drop policy if exists hq_knowledge_pages_staff_read on public.hq_knowledge_pages;
create policy hq_knowledge_pages_staff_read
on public.hq_knowledge_pages for select to authenticated
using (exists (
  select 1 from public.hq_tour_staff s
  where s.user_id = (select auth.uid()) and s.active
));

-- A private bucket must also have a read policy; public=false alone is not the
-- access policy. Uploads/deletions are performed only by an administrator.
insert into storage.buckets (id, name, public)
values ('hq-knowledge-media', 'hq-knowledge-media', false)
on conflict (id) do update set public=false;

drop policy if exists hq_knowledge_media_staff_read on storage.objects;
create policy hq_knowledge_media_staff_read
on storage.objects for select to authenticated
using (
  bucket_id = 'hq-knowledge-media'
  and exists (
    select 1 from public.hq_tour_staff s
    where s.user_id = (select auth.uid()) and s.active
  )
);

-- Restrictive guards are AND-combined with every applicable permissive policy.
-- An older broad Storage read policy must not accidentally expose this bucket.
-- Separate roles avoid an anonymous query evaluating the private staff table.
drop policy if exists hq_knowledge_media_anon_block on storage.objects;
create policy hq_knowledge_media_anon_block
on storage.objects as restrictive for select to anon
using (bucket_id <> 'hq-knowledge-media');

drop policy if exists hq_knowledge_media_staff_guard on storage.objects;
create policy hq_knowledge_media_staff_guard
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'hq-knowledge-media'
  or exists (
    select 1 from public.hq_tour_staff s
    where s.user_id = (select auth.uid()) and s.active
  )
);

comment on table public.hq_knowledge_pages is
  'Private Paws HQ knowledgebase and search content. Browser roles have read-only access through the shared active workspace membership.';

notify pgrst, 'reload schema';
commit;
