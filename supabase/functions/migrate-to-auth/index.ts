import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: accounts, error } = await admin.from('accounts').select('id, username, password');
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const results = [];
    for (const account of accounts || []) {
      const email = `${account.id}@daesol.el`;
      const { data, error: authError } = await admin.auth.admin.createUser({
        email,
        password: String(account.password),
        email_confirm: true
      });
      results.push({
        username: account.username,
        email,
        success: !authError,
        error: authError?.message || null
      });
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
