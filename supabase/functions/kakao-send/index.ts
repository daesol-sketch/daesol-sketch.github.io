import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 고장 상세 [💬 카톡 보내기] → 고른 직원들에게 카카오 알림톡 (로그인한 직원만 호출 가능)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*'
};
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json', ...CORS }
});

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function solapiAuth(apiKey: string, secret: string) {
  const date = new Date().toISOString();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt)));
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}`;
}
const digits = (s: string | null) => (s || '').replace(/\D/g, '');
const fmtPhone = (s: string | null) => {
  const d = digits(s);
  if (/^01\d{8,9}$/.test(d)) return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^02\d{7,8}$/.test(d)) return d.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^0\d{9,10}$/.test(d)) return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  return (s || '').trim();
};
const fmtTime = (s: string | null) => {
  if (!s) return '-';
  const p = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(s)).map(x => [x.type, x.value]));
  return `${p.month}/${p.day}(${p.weekday}) ${p.hour}:${p.minute}`;
};
const v = (s: string | null, max = 100) => {
  const t = (s || '').trim();
  if (!t) return '-';
  return t.length > max ? t.slice(0, max) + '…' : t;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 호출자 확인: 로그인한 재직 직원만
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let me: { username: string } | null = null;
    if (token) {
      const { data: { user } } = await db.auth.getUser(token);
      const accId = user?.email ? user.email.split('@')[0] : '';
      if (/^\d+$/.test(accId)) {
        const { data } = await db.from('accounts').select('username').eq('id', accId).eq('status', '재직').maybeSingle();
        me = data;
      }
    }
    if (!me) return json({ error: 'unauthorized' }, 401);

    const API_KEY = Deno.env.get('SOLAPI_API_KEY');
    const API_SECRET = Deno.env.get('SOLAPI_API_SECRET');
    const PFID = Deno.env.get('SOLAPI_PFID');
    const SENDER = Deno.env.get('SOLAPI_SENDER');
    // V2(승강기번호·접수자·신고자 연락처) 템플릿 ID가 있으면 V2로, 없으면 기존 템플릿
    const TPL_V2 = Deno.env.get('SOLAPI_TPL_FORWARD_V2');
    const TPL = TPL_V2 || Deno.env.get('SOLAPI_TPL_FORWARD');
    if (!API_KEY || !API_SECRET || !PFID || !TPL) return json({ error: 'no_key' }, 503);

    const { report_id, recipients } = await req.json().catch(() => ({}));
    const names = [...new Set((Array.isArray(recipients) ? recipients : []).map((n: unknown) => String(n).trim()).filter(Boolean))];
    if (!report_id || !names.length) return json({ error: '신고번호나 받는 사람이 없습니다.' }, 400);
    if (names.length > 20) return json({ error: '한 번에 20명까지 보낼 수 있습니다.' }, 400);

    const { data: r } = await db.from('reports').select('id, building, elevator, type, name, phone, description, created_at, regno').eq('id', report_id).maybeSingle();
    if (!r) return json({ error: '신고를 찾을 수 없습니다.' }, 404);
    const { data: accs } = await db.from('accounts').select('username, phone').in('username', names).eq('status', '재직');

    const vars = {
      '#{보낸사람}': v(me.username),
      '#{현장}': v(r.building),
      '#{호기}': v(r.elevator),
      '#{유형}': v(r.type),
          '#{접수시간}': fmtTime(r.created_at),
      '#{접수번호}': v(r.id),
      ...(TPL_V2 ? { '#{접수자}': v(r.name), '#{승강기번호}': v(r.regno) } : { '#{신고자}': v(r.name) }),
      '#{연락처}': v(fmtPhone(r.phone)),
      '#{신고내용}': v(r.description, 300)
    };
    const targets: { name: string; to: string }[] = [];
    const noPhone: string[] = [];
    names.forEach(n => {
      const to = digits((accs || []).find(a => a.username === n)?.phone || '');
      if (/^01\d{8,9}$/.test(to)) targets.push({ name: n, to }); else noPhone.push(n);
    });
    const logs = noPhone.map(n => ({ report_id: r.id, kind: 'manual', sender: me!.username, recipient: n, phone: null, status: 'no_phone', detail: null }));

    let sent: string[] = [], failed: string[] = [];
    if (targets.length) {
      const messages = targets.map(t => {
        const m: Record<string, unknown> = { to: t.to, kakaoOptions: { pfId: PFID, templateId: TPL, variables: vars, disableSms: !SENDER } };
        if (SENDER) m.from = digits(SENDER);
        return m;
      });
      const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await solapiAuth(API_KEY, API_SECRET) },
        body: JSON.stringify({ messages })
      });
      const out = await res.json().catch(() => ({}));
      const failedTo = new Set((out.failedMessageList || []).map((f: { to?: string }) => digits(f.to || '')));
      targets.forEach(t => {
        const bad = !res.ok || failedTo.has(t.to);
        (bad ? failed : sent).push(t.name);
        logs.push({ report_id: r.id, kind: 'manual', sender: me!.username, recipient: t.name, phone: t.to, status: bad ? 'failed' : 'sent',
          detail: bad ? JSON.stringify(out.failedMessageList?.length ? out.failedMessageList.map((m: Record<string, unknown>) => ({ to: m.to, code: m.statusCode, msg: m.statusMessage })) : out).slice(0, 500) : (out.groupInfo?.groupId || null) });
      });
    }
    if (logs.length) await db.from('kakao_logs').insert(logs);
    return json({ ok: true, sent, failed, noPhone });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
