import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

// 메모 형태("1호기,2호기: 010-2075-3312") 텍스트에서 9~12자리 전화번호 패턴만 추출 후 정규화
function extractPhones(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = String(text).match(/(\d[\d\s\-]{7,15}\d)/g);
  if (!matches) return [];
  return matches.map(m => m.replace(/\D/g, '')).filter(n => n.length >= 9 && n.length <= 12);
}

const EMERG_COLS = [
  'emergency_phone',
  'emergency_phone2',
  'emergency_phone3',
  'emergency_phone4',
  'emergency_phone5',
  'emergency_phone6',
  'emergency_phone7',
  'emergency_phone8',
  'emergency_phone9',
  'emergency_phone10'
];
const PHONE_COLS = ['site_phone', 'site_phone2', 'manager_mobile'];
const SITE_SELECT = ['site_name', ...PHONE_COLS, ...EMERG_COLS].join(',');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  try {
    const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    webpush.setVapidDetails('mailto:admin@daesol.com', VAPID_PUBLIC, VAPID_PRIVATE);

    const url = new URL(req.url);
    const sender = url.searchParams.get('sender') || '';
    const kind   = url.searchParams.get('kind') || '';

    console.log(`[call-notify] sender=${sender} kind=${kind}`);

    if (kind !== '1') {
      console.log('[call-notify] kind!=1, skip');
      return new Response('ok', { status: 200 });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const normalizedSender = normalizePhone(sender);

    const { data: sites } = await db
      .from('managed_sites')
      .select(SITE_SELECT);

    let siteName: string | null = null;
    if (sites) {
      const matched = sites.find((s: any) => {
        // 일반 전화 컬럼: 정규화 후 정확 일치
        for (const col of PHONE_COLS) {
          if (s[col] && normalizePhone(s[col]) === normalizedSender) return true;
        }
        // 비상통화장치 컬럼: 텍스트에서 전화번호 패턴 추출 후 매칭 (메모 형식 지원)
        for (const col of EMERG_COLS) {
          if (s[col] && extractPhones(s[col]).includes(normalizedSender)) return true;
        }
        return false;
      });
      if (matched) siteName = matched.site_name;
    }

    // 현장에서 못 찾으면 직원 전화번호에서 조회
    let employeeName: string | null = null;
    if (!siteName) {
      const { data: accounts } = await db
        .from('accounts')
        .select('username, phone, position');
      if (accounts) {
        const matched = accounts.find((a: any) => a.phone && normalizePhone(a.phone) === normalizedSender);
        if (matched) {
          employeeName = matched.position
            ? `${matched.position} ${matched.username}`
            : matched.username;
        }
      }
    }

    console.log(`[call-notify] siteName=${siteName} employeeName=${employeeName}`);

    const title = '📞 전화 착신';
    const body  = siteName ? `${siteName} (${sender})` : employeeName ? `직원 ${employeeName} (${sender})` : `미등록 번호 (${sender})`;

    const { data: admins } = await db
      .from('accounts')
      .select('id')
      .in('role', ['관리자', '마스터']);

    console.log(`[call-notify] admins=${JSON.stringify(admins)}`);

    if (!admins?.length) {
      console.log('[call-notify] no admins');
      return new Response('ok', { status: 200 });
    }

    const adminIds = admins.map((a: any) => String(a.id));

    const { data: subs } = await db
      .from('push_subscriptions')
      .select('account_id, username, subscription')
      .in('account_id', adminIds)
      .or('is_mobile.eq.false,is_mobile.is.null');

    console.log(`[call-notify] subs count=${subs?.length ?? 0}`);

    if (!subs?.length) {
      console.log('[call-notify] no subs');
      return new Response('ok', { status: 200 });
    }

    const results = await Promise.allSettled(
      subs.map((s: any) =>
        webpush.sendNotification(
          s.subscription,
          JSON.stringify({ title, body, type: 'call', siteName: siteName || null, phone: sender }),
          { TTL: 30 }
        )
      )
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const username = subs[i].username;
      const accountId = subs[i].account_id;
      if (r.status === 'rejected') {
        console.log(`[call-notify] push[${i}] (${username}) failed: ${r.reason}`);
        const errMsg = String(r.reason);
        if (errMsg.includes('410') || errMsg.includes('unexpected response')) {
          await db.from('push_subscriptions').delete().eq('account_id', accountId);
          console.log(`[call-notify] push[${i}] (${username}) expired sub removed`);
        }
      } else {
        console.log(`[call-notify] push[${i}] (${username}) ok`);
      }
    }

    return new Response('ok', { status: 200 });

  } catch (e: any) {
    console.log(`[call-notify] error: ${e.message}`);
    return new Response('error: ' + e.message, { status: 500 });
  }
});
