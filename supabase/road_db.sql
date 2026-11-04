-- 📆 로드표 — 우리 앱 전용 (부장님 시스템 영향 없음, road_ 이름 중복 없음 확인 11/4)
-- road_site_plans: 현장마다 '몇째 주·요일'(여러 개) + 점검 주기 표시 + 로드표용 짧은 이름. 매달 같은 주·요일로 채워짐
-- road_submits: 조 × 월 제출 기록

create table if not exists road_site_plans (
  site_id bigint primary key references managed_sites(id) on delete cascade,
  slots jsonb not null default '[]'::jsonb,          -- [{"w":1,"d":0}, ...]  w=몇째 주(1~6), d=요일(0=월~4=금)
  cycle text not null default '매월' check (cycle in ('매월','격월','분기')),
  short_name text,
  updated_by text,
  updated_at timestamptz default now()
);

create table if not exists road_submits (
  team_id bigint not null references inspection_teams(id) on delete cascade,
  ym text not null check (ym ~ '^\d{4}-\d{2}$'),
  total integer not null default 0,
  submitted_by text,
  submitted_at timestamptz default now(),
  primary key (team_id, ym)
);

-- 권한 도우미
create or replace function road_me() returns text language sql stable security definer set search_path = public as $$
  select username from accounts where id::text = split_part(auth.email(), '@', 1) and status = '재직'
$$;
create or replace function road_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from accounts where id::text = split_part(auth.email(), '@', 1) and status = '재직' and role in ('관리자','마스터'))
$$;
create or replace function road_in_team(t bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from inspection_teams where id = t and road_me() is not null
                 and road_me() in (trim(main_inspector), trim(sub_inspector), trim(sub_inspector2)))
$$;
create or replace function road_site_team(s bigint) returns bigint language sql stable security definer set search_path = public as $$
  select team_id from managed_sites where id = s
$$;

-- 누가·언제 고쳤는지/제출했는지는 서버가 기록
create or replace function road_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'road_site_plans' then
    new.updated_by := coalesce(road_me(), new.updated_by); new.updated_at := now();
  else
    new.submitted_by := coalesce(road_me(), new.submitted_by); new.submitted_at := now();
  end if;
  return new;
end $$;
drop trigger if exists road_site_plans_stamp on road_site_plans;
create trigger road_site_plans_stamp before insert or update on road_site_plans for each row execute function road_stamp();
drop trigger if exists road_submits_stamp on road_submits;
create trigger road_submits_stamp before insert or update on road_submits for each row execute function road_stamp();

alter table road_site_plans enable row level security;
alter table road_submits enable row level security;

-- 보기: 로그인 직원 모두 / 쓰기: 관리자 전체, 조원은 자기 조 현장만
drop policy if exists road_site_plans_select on road_site_plans;
create policy road_site_plans_select on road_site_plans for select to authenticated using (true);
drop policy if exists road_site_plans_write on road_site_plans;
create policy road_site_plans_write on road_site_plans for all to authenticated
  using (road_is_admin() or road_in_team(road_site_team(site_id)))
  with check (road_is_admin() or road_in_team(road_site_team(site_id)));

drop policy if exists road_submits_select on road_submits;
create policy road_submits_select on road_submits for select to authenticated using (true);
drop policy if exists road_submits_write on road_submits;
create policy road_submits_write on road_submits for all to authenticated
  using (road_is_admin() or road_in_team(team_id))
  with check (road_is_admin() or road_in_team(team_id));

revoke all on road_site_plans, road_submits from anon;

-- 11/4 추가: 격월 없앰(매월·분기만), 분기 현장의 점검 달
alter table road_site_plans drop constraint if exists road_site_plans_cycle_check;
alter table road_site_plans add constraint road_site_plans_cycle_check check (cycle in ('매월','분기'));
alter table road_site_plans add column if not exists q_month smallint check (q_month between 1 and 3);
comment on column road_site_plans.q_month is '분기 현장의 점검 달: 1=1·4·7·10월, 2=2·5·8·11월, 3=3·6·9·12월';
