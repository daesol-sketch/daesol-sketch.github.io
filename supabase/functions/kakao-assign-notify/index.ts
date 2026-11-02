import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 고장 첫 배정 → 담당자에게 카카오 알림톡 (DB 트리거가 호출)
// 신고마다 1번만: kakao_sent_at 이 비어 있고, 방금(10분 이내) 배정된 건만 보냄
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json' }
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
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const API_KEY = Deno.env.get('SOLAPI_API_KEY');
    const API_SECRET = Deno.env.get('SOLAPI_API_SECRET');
    const PFID = Deno.env.get('SOLAPI_PFID');
    const SENDER = Deno.env.get('SOLAPI_SENDER');
    const TPL = Deno.env.get('SOLAPI_TPL_ASSIGN');

    const { report_id } = await req.json().catch(() => ({}));
    if (!report_id) return json({ error: 'report_id 없음' }, 400);
    // 솔라피 설정 전에는 아무것도 하지 않음
    if (!API_KEY || !API_SECRET || !PFID || !TPL) return json({ skipped: 'no_key' });

    // 먼저 "보냄" 표시를 걸어서 중복 발송 막기 (조건 맞는 건만 1번 성공)
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: rows, error } = await db.from('reports')
      .update({ kakao_sent_at: new Date().toISOString() })
      .eq('id', report_id).is('kakao_sent_at', null).eq('status', '배치완료')
      .not('completion_handler', 'is', null).gte('assigned_at', since)
      .select('id, building, elevator, type, name, phone, description, created_at, completion_handler');
    if (error) return json({ error: error.message }, 500);
    const r = rows?.[0];
    if (!r) return json({ skipped: 'not_target' });

    const { data: acc } = await db.from('accounts').select('username, phone').eq('username', r.completion_handler).eq('status', '재직').maybeSingle();
    const to = digits(acc?.phone || '');
    const log = (status: string, detail: string | null) => db.from('kakao_logs').insert({
      report_id: r.id, kind: 'assign', sender: null, recipient: r.completion_handler, phone: to || null, status, detail
    });
    if (!/^01\d{8,9}$/.test(to)) { await log('no_phone', null); return json({ skipped: 'no_phone' }); }

    const message: Record<string, unknown> = {
      to,
      kakaoOptions: {
        pfId: PFID,
        templateId: TPL,
        variables: {
          '#{담당자}': v(r.completion_handler),
          '#{현장}': v(r.building),
          '#{호기}': v(r.elevator),
          '#{유형}': v(r.type),
          '#{접수시간}': fmtTime(r.created_at),
          '#{접수번호}': v(r.id),
          '#{신고자}': v(r.name),
          '#{연락처}': v(fmtPhone(r.phone)),
          '#{신고내용}': v(r.description, 300)
        },
        disableSms: !SENDER
      }
    };
    if (SENDER) message.from = digits(SENDER);

    const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await solapiAuth(API_KEY, API_SECRET) },
      body: JSON.stringify({ messages: [message] })
    });
    const out = await res.json().catch(() => ({}));
    const failed = !res.ok || (out.failedMessageList || []).length > 0;
    await log(failed ? 'failed' : 'sent', failed ? JSON.stringify(out.failedMessageList?.length ? out.failedMessageList.map((m: Record<string, unknown>) => ({ to: m.to, code: m.statusCode, msg: m.statusMessage })) : out).slice(0, 500) : (out.groupInfo?.groupId || null));
    return json({ ok: !failed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
