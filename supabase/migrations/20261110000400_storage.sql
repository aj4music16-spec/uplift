-- Private evidence storage.
--
--   * The bucket is private. Nothing is ever public.
--   * Size and declared MIME type are enforced by the storage service
--     (10 MB, JPEG/PNG) and re-checked from object metadata when a submission
--     is finalized.
--   * Object paths are unguessable and issued by public.begin_evidence_upload:
--       <user id>/<challenge id>/<date>/<random uuid>.<ext>
--   * Upload is only possible to a destination that was staged for you and has
--     not expired. Reading (and therefore minting a signed URL) is limited to
--     the participant, while still a Circle member, and assigned challenge admins.
--   * Objects are immutable: there is no UPDATE policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.can_upload_evidence(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evidence_uploads u
    where u.object_path = p_name
      and u.user_id = auth.uid()
      and u.finalized_at is null
      and u.expires_at > app.now()
  )
$$;

create or replace function app.can_read_evidence(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evidence e
    join public.submissions s on s.id = e.submission_id
    where e.private_object_path = p_name
      and e.purged_at is null
      and app.can_view_record(s.daily_record_id)
  )
  or exists (
    -- Your own staged upload, before it is attached to a submission.
    select 1
    from public.evidence_uploads u
    where u.object_path = p_name and u.user_id = auth.uid() and u.finalized_at is null
  )
$$;

create or replace function app.can_delete_evidence(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- An abandoned upload that never became a submission.
    select 1
    from public.evidence_uploads u
    where u.object_path = p_name and u.user_id = auth.uid() and u.finalized_at is null
  )
  or exists (
    -- Your own evidence, once you have started deleting your account.
    select 1
    from public.evidence e
    join public.profiles p on p.id = e.uploaded_by
    where e.private_object_path = p_name
      and e.uploaded_by = auth.uid()
      and p.deletion_requested_at is not null
  )
$$;

grant execute on function app.can_upload_evidence(text), app.can_read_evidence(text), app.can_delete_evidence(text) to authenticated;

create policy "evidence: upload only to a staged destination"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and app.can_upload_evidence(name));

create policy "evidence: participant and assigned admins can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and app.can_read_evidence(name));

create policy "evidence: remove abandoned or deletion-pending files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and app.can_delete_evidence(name));
