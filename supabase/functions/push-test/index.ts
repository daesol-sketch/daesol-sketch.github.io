import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

// 화면이 꺼지고 절전에 들어갈 시간을 준 뒤 발송한다. 나중에 조정하려면 이 값만 바꾸면 됨.
const DELAY_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    webpush.setVapidDetails('mailto:admin@daesol.com', VAPID_PUBLIC, VAPID_PRIVATE);

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { accountId, username } = await req.json();

    if (!accountId) {
      return new Response(JSON.stringify({ error: 'no_account' }), { status: 400, headers: CORS });
    }

    // 이 계정의 구독 조회 (폰·PC 모두)
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('subscription, is_mobile')
      .eq('account_id', String(accountId));

    if (!subs?.length) {
      return new Response(JSON.stringify({ error: 'no_subscription' }), { status: 200, headers: CORS });
    }

    // 기기별로 테스트 행을 만든다 (폰과 PC 결과를 따로 봐야 하므로)
    const rows = subs.map((s: any) => ({
      account_id: String(accountId),
      username: username || null,
      is_mobile: s.is_mobile === true
    }));

    const { data: tests, error: insErr } = await db
      .from('app_push_tests')
      .insert(rows)
      .select('id, is_mobile');

    if (insErr || !tests?.length) {
      return new Response(JSON.stringify({ error: 'insert_failed: ' + (insErr?.message || '') }), { status: 500, headers: CORS });
    }

    // 응답은 먼저 돌려주고, 대기 후 발송은 백그라운드에서 계속한다
    const job = (async () => {
      await new Promise(resolve => setTimeout(resolve, DELAY_SECONDS * 1000));

      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const test = tests[i];   // insert 순서와 구독 순서가 같음
        if (!test) continue;

        try {
          // 발송 시각을 먼저 기록해야 도착 시각과의 차이를 잴 수 있다
          await db.from('app_push_tests').update({ sent_at: new Date().toISOString() }).eq('id', test.id);

          await webpush.sendNotification(
            sub.subscription,
            JSON.stringify({
              title: '🔔 알림 테스트',
              body: '이 알림이 보이면 정상입니다. 앱을 열어 결과를 확인하세요.',
              type: 'push-test',
              testId: test.id,
              requireInteraction: sub.is_mobile === true
            }),
            { TTL: 1800, urgency: 'high' }
          );
          console.log(`[push-test] sent id=${test.id} mobile=${sub.is_mobile}`);
        } catch (e: any) {
          console.log(`[push-test] failed id=${test?.id}: ${e.message}`);
          const msg = String(e.message);
          if (msg.includes('410') || msg.includes('404')) {
            await db.from('push_subscriptions').delete().eq('endpoint', sub.subscription.endpoint);
          }
        }
      }
    })();

    // @ts-ignore  Supabase Edge Runtime 전용 API
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(job);
    } else {
      await job;
    }

    return new Response(JSON.stringify({
      ok: true,
      delaySeconds: DELAY_SECONDS,
      devices: subs.length,
      testIds: tests.map((t: any) => t.id)
    }), { headers: CORS });

  } catch (e: any) {
    console.log(`[push-test] error: ${e.message}`);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
});
