import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // ── 호출자 확인: 로그인 세션 토큰 필수 (공개 anon 키로는 user가 나오지 않음) ──
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: authData } = await admin.auth.getUser(jwt);
    const callerEmail = authData?.user?.email || '';
    if (!callerEmail.endsWith('@daesol.el')) return json({ error: '로그인이 필요합니다.' }, 401);
    const callerId = callerEmail.split('@')[0];
    const { data: me } = await admin.from('accounts').select('id, role').eq('id', callerId).maybeSingle();
    if (!me) return json({ error: '계정 정보를 찾을 수 없습니다.' }, 403);
    const isAdmin = me.role === '관리자' || me.role === '마스터';

    const { action, account_id, password } = await req.json();
    const targetId = String(account_id);

    // ── 권한 확인 ──
    if (action === 'change_password') {
      // 본인 비밀번호만
      if (targetId !== String(me.id)) return json({ error: '본인 비밀번호만 변경할 수 있습니다.' }, 403);
    } else if (action === 'create' || action === 'reset_password') {
      // 관리자·마스터만, 마스터 계정은 마스터만
      if (!isAdmin) return json({ error: '권한이 없습니다.' }, 403);
      const { data: target } = await admin.from('accounts').select('role').eq('id', targetId).maybeSingle();
      if (!target) return json({ error: '대상 계정을 찾을 수 없습니다.' }, 404);
      if (target.role === '마스터' && me.role !== '마스터') return json({ error: '마스터 계정은 마스터만 변경할 수 있습니다.' }, 403);
    } else {
      return json({ error: 'unknown action' }, 400);
    }

    if (action === 'create') {
      // 새 계정 생성: account_id와 password를 받아 Supabase Auth 유저 생성
      const email = `${targetId}@daesol.el`;
      const { error } = await admin.auth.admin.createUser({
        email,
        password: String(password),
        email_confirm: true
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // reset_password / change_password
    const email = `${targetId}@daesol.el`;
    // 페이지네이션 없이 한 번에 다 가져오기 (perPage 1000)
    let user: any = null;
    let page = 1;
    while (true) {
      const { data: result } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      user = result?.users?.find((u: any) => u.email === email);
      if (user) break;
      if (!result?.users || result.users.length < 1000) break;
      page++;
    }
    if (!user) {
      // 유저 없으면 새로 생성 (accounts에 있지만 Auth에 없을 때)
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password: String(password),
        email_confirm: true
      });
      if (createErr) return json({ error: 'user not found, create failed: ' + createErr.message }, 404);
      return json({ ok: true, created: true });
    }
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: String(password) });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
