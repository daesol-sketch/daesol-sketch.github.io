import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

Deno.serve(async () => {
  const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  webpush.setVapidDetails('mailto:admin@daesol.com', VAPID_PUBLIC, VAPID_PRIVATE);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const threshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();

  // 배치 후 3분 이상 담당자가 미확인인 건 조회
  const { data: reports } = await db
    .from('reports')
    .select('id, building, elevator, completion_handler')
    .eq('status', '배치완료')
    .is('confirmed_at', null)
    .not('assigned_at', 'is', null)
    .lt('assigned_at', threshold);

  if (!reports?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  // 고유 담당자 목록
  const handlers = [...new Set(reports.map((r: any) => r.completion_handler).filter(Boolean))];

  // 관리자 계정 조회
  const { data: admins } = await db.from('accounts').select('id').in('role', ['관리자', '마스터']);
  if (!admins?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  const adminIds = admins.map((a: any) => String(a.id));

  // 관리자 푸시 구독 조회 (모바일/PC 모두)
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('account_id, subscription')
    .in('account_id', adminIds);

  if (!subs?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  let sent = 0;
  for (const handler of handlers) {
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title: '⚠️ 담당자 신고접수 미확인 알림',
            body: `${handler}담당자가 배치받은 알림을 확인하지 않았습니다. 전화로 신고내용을 전달해주세요.`
          }),
          { TTL: 120 }
        );
        sent++;
      } catch(e: any) {
        console.log(`push failed: ${e.message}`);
      }
    }
  }

  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
