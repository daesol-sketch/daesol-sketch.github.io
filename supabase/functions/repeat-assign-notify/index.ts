import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

Deno.serve(async () => {
  const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  webpush.setVapidDetails('mailto:admin@daesol.com', VAPID_PUBLIC, VAPID_PRIVATE);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  // 배치 후 2분 이상 담당자가 미확인인 건 조회
  const { data: reports } = await db
    .from('reports')
    .select('id, building, elevator, completion_handler')
    .eq('status', '배치완료')
    .is('confirmed_at', null)
    .not('assigned_at', 'is', null)
    .lt('assigned_at', threshold);

  if (!reports?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  let sent = 0;
  for (const r of reports) {
    if (!r.completion_handler) continue;

    const { data: subs } = await db
      .from('push_subscriptions')
      .select('subscription')
      .eq('username', r.completion_handler);

    if (!subs?.length) continue;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title: '🔧 고장 신고 배정',
            body: `${r.building} ${r.elevator} 고장 신고가 배정되었습니다.`,
            reportId: r.id
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
