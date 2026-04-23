-- =============================================
-- 대솔이엘 RLS 설정 (Supabase SQL Editor에서 실행)
-- =============================================

-- 1. 로그인용 헬퍼 함수 (anon이 username → auth email 조회)
CREATE OR REPLACE FUNCTION get_user_auth_email(p_username text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id::text || '@daesol.el' FROM accounts WHERE username = p_username LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION get_user_auth_email TO anon;

-- 2. 모든 테이블 RLS 활성화
ALTER TABLE reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE managed_sites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE duty_roster       ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays          ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_elevators    ENABLE ROW LEVEL SECURITY;

-- 3. 로그인한 직원만 전체 접근 허용 정책
CREATE POLICY "auth_full" ON reports            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON accounts           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON managed_sites      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON duty_roster        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON holidays           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full" ON site_elevators     FOR ALL TO authenticated USING (true) WITH CHECK (true);
