-- 11/6: 현장명 짧게 + 검색 키워드, 현장명 바꿀 때 관련 기록도 같이 바꾸고 이력 남김 (부장님 동의: 변경 이력 남길 것)

-- 1) 검색 키워드 칸 (관리자만 수정)
alter table managed_sites add column if not exists search_keywords text;
comment on column managed_sites.search_keywords is '검색 키워드 (관리현장·고장 접수 검색용, 관리자만 수정)';

create or replace function protect_site_keywords() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.search_keywords is distinct from (case when tg_op = 'UPDATE' then old.search_keywords else null end)
     and auth.uid() is not null and not road_is_admin() then
    raise exception '검색 키워드는 관리자만 바꿀 수 있습니다.';
  end if;
  return new;
end $$;
drop trigger if exists check_site_keywords on managed_sites;
create trigger check_site_keywords before insert or update of search_keywords on managed_sites for each row execute function protect_site_keywords();

-- 2) 현장명 변경 이력
create table if not exists site_name_changes (
  id bigserial primary key,
  site_id bigint,
  old_name text not null,
  new_name text not null,
  counts jsonb not null default '{}'::jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
alter table site_name_changes enable row level security;
drop policy if exists site_name_changes_read on site_name_changes;
create policy site_name_changes_read on site_name_changes for select to authenticated using (true);
revoke all on site_name_changes from anon;

-- 3) 현장명 바꾸기 (관리자만). p_dry_run = true 면 바꾸지 않고 몇 건 바뀔지만 셈
create or replace function rename_site(p_site_id bigint, p_new_name text, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old text; v_new text := trim(p_new_name);
  v_counts jsonb := '{}'::jsonb; v_total int := 0; n int; r record;
begin
  if auth.uid() is not null and not road_is_admin() then raise exception '현장명은 관리자만 바꿀 수 있습니다.'; end if;
  if v_new is null or v_new = '' then raise exception '새 현장명이 비어 있습니다.'; end if;
  select site_name into v_old from managed_sites where id = p_site_id;
  if not found then raise exception '현장을 찾을 수 없습니다.'; end if;
  if trim(v_old) = v_new then
    return jsonb_build_object('old', v_old, 'new', v_new, 'counts', '{}'::jsonb, 'total', 0);
  end if;
  if exists (select 1 from managed_sites where id <> p_site_id and trim(site_name) = v_new) then
    raise exception '같은 이름의 현장이 이미 있습니다: %', v_new;
  end if;

  for r in select * from (values
    ('reports','building','고장 접수'), ('service_dockets','site_name','서비스다켓'), ('call_logs','site_name','전화기록'),
    ('quotes','site_name','견적'), ('quote_requests','site_name','견적 요청'), ('purchase_orders','site_name','발주'),
    ('purchase_orders_legacy','site_name','발주(옛)'), ('invoices','site_name','청구서'), ('sales_invoices','site_name','매출 청구서'),
    ('sales_tax','site_name','세금계산서'), ('material_requests','site_name','자재 요청'), ('transactions','site_name','거래'),
    ('tbm_records','site_name','TBM'), ('overtime_reports','site_name','잔업'), ('hazard_surveys','site_name','위험성평가'),
    ('construction_requests','site_name','공사 요청'), ('construction_schedules','site_name','공사 일정'), ('incentive_records','site','인센티브')
  ) t(tbl, col, label) loop
    continue when to_regclass('public.' || r.tbl) is null;
    if p_dry_run then
      execute format('select count(*) from %I where trim(%I) = trim($1)', r.tbl, r.col) into n using v_old;
    else
      execute format('update %I set %I = $2 where trim(%I) = trim($1)', r.tbl, r.col, r.col) using v_old, v_new;
      get diagnostics n = row_count;
    end if;
    if n > 0 then v_counts := v_counts || jsonb_build_object(r.label, n); v_total := v_total + n; end if;
  end loop;

  if not p_dry_run then
    update managed_sites set site_name = v_new where id = p_site_id;
    insert into site_name_changes(site_id, old_name, new_name, counts, changed_by)
      values (p_site_id, v_old, v_new, v_counts, coalesce(road_me(), 'SQL'));
  end if;
  return jsonb_build_object('old', v_old, 'new', v_new, 'counts', v_counts, 'total', v_total);
end $$;
revoke all on function rename_site(bigint, text, boolean) from public, anon;
grant execute on function rename_site(bigint, text, boolean) to authenticated;

-- 되돌리기:
-- drop function if exists rename_site(bigint, text, boolean); drop table if exists site_name_changes;
-- drop trigger if exists check_site_keywords on managed_sites; drop function if exists protect_site_keywords(); alter table managed_sites drop column if exists search_keywords;
