alter table public.reports add column if not exists kakao_sent_at timestamptz;

create table if not exists public.kakao_logs (
  id bigserial primary key,
  report_id text,
  kind text not null,          -- assign(자동 배정) / manual(골라서 보내기)
  sender text,
  recipient text,
  phone text,
  status text not null,        -- sent / failed / no_phone
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists kakao_logs_report_idx on public.kakao_logs(report_id);
alter table public.kakao_logs enable row level security;
revoke all on public.kakao_logs from anon;
revoke insert, update, delete on public.kakao_logs from authenticated;
grant select on public.kakao_logs to authenticated;
drop policy if exists kakao_logs_select on public.kakao_logs;
create policy kakao_logs_select on public.kakao_logs for select to authenticated using (true);

-- 담당자가 처음 정해지면(배치완료) 알림톡 함수 호출. 실패해도 저장은 그대로 진행
create or replace function public.kakao_assign_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.completion_handler is not null and new.completion_handler <> ''
     and new.status = '배치완료' and new.kakao_sent_at is null
     and (tg_op = 'INSERT' or coalesce(old.completion_handler, '') = '') then
    begin
      perform net.http_post(
        url := 'https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/kakao-assign-notify',
        body := jsonb_build_object('report_id', new.id),
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.kakao_assign_trigger() from public, anon, authenticated;

drop trigger if exists reports_kakao_assign on public.reports;
create trigger reports_kakao_assign after insert or update of completion_handler, status on public.reports
  for each row execute function public.kakao_assign_trigger();

-- 2026-11-02: 신고 삭제 시 카톡 기록도 삭제 (접수번호 재사용 때 옛 기록이 붙는 문제)
alter table public.kakao_logs add constraint kakao_logs_report_id_fkey foreign key (report_id) references public.reports(id) on delete cascade;
