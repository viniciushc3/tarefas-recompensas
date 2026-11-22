-- =====================================================================
-- Bucket das fotos de comprovação.
-- Privado. Caminho esperado: <profile_id>/<occurrence_id>.jpg — é o prefixo
-- que amarra a foto a quem a enviou.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('provas', 'provas', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Ela envia só na própria pasta.
create policy provas_child_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'provas'
    and (storage.foldername(name))[1] = auth.uid()::text);

-- Família inteira lê (você precisa ver a foto para aprovar).
create policy provas_family_read on storage.objects
  for select to authenticated using (
    bucket_id = 'provas'
    and exists (
      select 1 from profiles p
       where p.id::text = (storage.foldername(name))[1]
         and p.family_id = app.current_family_id()));

-- Só o responsável apaga.
create policy provas_parent_delete on storage.objects
  for delete to authenticated using (bucket_id = 'provas' and app.is_parent());
