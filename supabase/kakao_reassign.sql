-- 2026-11-02: 관리자가 담당자를 바꿀 때(배치완료·미확인)도 새 담당자에게 배정 카톡
alter table public.reports add column if not exists kakao_sent_to text;
update public.reports set kakao_sent_to = completion_handler where kakao_sent_at is not null and kakao_sent_to is null;

create or replace function public.kakao_assign_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- 처음 배정 또는 담당자 변경 + 아직 배치완료·미확인 (본인 재배치는 바로 처리중이라 제외)
  if coalesce(new.completion_handler, '') <> ''
     and new.status = '배치완료' and new.confirmed_at is null
     and (tg_op = 'INSERT' or coalesce(old.completion_handler, '') is distinct from new.completion_handler) then
    begin
      perform net.http_post(
        url := 'https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/kakao-assign-notify',
        body := jsonb_build_object('report_id', new.id, 'handler', new.completion_handler),
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.kakao_assign_trigger() from public, anon, authenticated;
