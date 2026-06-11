import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { action, account_id, password } = await req.json();

    if (action === 'create') {
      // 새 계정 생성: account_id와 password를 받아 Supabase Auth 유저 생성
      const email = `${account_id}@daesol.el`;
      const { error } = await admin.auth.admin.createUser({
        email,
        password: String(password),
        email_confirm: true
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    if (action === 'reset_password' || action === 'change_password') {
      const email = `${account_id}@daesol.el`;
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
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password: String(password),
          email_confirm: true
        });
        if (createErr) return new Response(JSON.stringify({ error: 'user not found, create failed: ' + createErr.message }), { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
        return new Response(JSON.stringify({ ok: true, created: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const { error } = await admin.auth.admin.updateUserById(user.id, { password: String(password) });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
});
