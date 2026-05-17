import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  webpush.setVapidDetails('mailto:admin@daesol.com', VAPID_PUBLIC, VAPID_PRIVATE);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { username, building, elevator, reportId } = await req.json();

  if (!username) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no_username' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('subscription, is_mobile')
    .eq('username', username);

  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no_subscription' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        sub.subscription,
        JSON.stringify({
          title: '🔧 고장 신고 배정',
          body: `${building} ${elevator} 고장 신고가 배정되었습니다.`,
          reportId,
          requireInteraction: sub.is_mobile === true
        }),
        { TTL: 120 }
      );
      sent++;
    } catch (e: any) {
      console.log(`push failed: ${e.message}`);
    }
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
});
