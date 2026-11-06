-- 11/4: 관리현장 짧은 이름(화면 표시용). 현장명(site_name)은 검색·연결용으로 그대로 둠.
-- 우리 앱 전용 칸 (부장님 met 코드는 managed_sites를 필요한 칸만 골라 읽어서 이 칸은 안 읽음, 확인함)
alter table managed_sites add column if not exists short_name text;
comment on column managed_sites.short_name is '대솔 앱 화면 표시용 짧은 이름 (관리자만 수정). 비우면 site_name 표시';

-- 짧은 이름은 관리자·마스터만 바꿀 수 있게 (서버·SQL Editor(auth.uid 없음)는 허용)
create or replace function protect_site_short_name() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.short_name is distinct from (case when tg_op = 'UPDATE' then old.short_name else null end)
     and auth.uid() is not null and not road_is_admin() then
    raise exception '짧은 이름은 관리자만 바꿀 수 있습니다.';
  end if;
  return new;
end $$;
drop trigger if exists check_site_short_name on managed_sites;
create trigger check_site_short_name before insert or update of short_name on managed_sites for each row execute function protect_site_short_name();

-- 되돌리기:
-- drop trigger if exists check_site_short_name on managed_sites; drop function if exists protect_site_short_name(); alter table managed_sites drop column if exists short_name;

-- 11/6: 짧은 이름 기능 거둠 (현장명 짧게 + 검색 키워드 방식으로, site_rename.sql). 배포(a2ef7cb) 후 실행
-- drop trigger if exists check_site_short_name on managed_sites; drop function if exists protect_site_short_name();
-- alter table managed_sites drop column if exists short_name; alter table road_site_plans drop column if exists short_name;
