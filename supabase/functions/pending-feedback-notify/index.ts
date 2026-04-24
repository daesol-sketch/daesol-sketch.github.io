import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  if (kstHour >= 23 || kstHour < 7) {
    return new Response(JSON.stringify({ sent: 0, reason: 'quiet hours' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const threshold = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

  const { data: reports } = await db
    .from('reports')
    .select('id, building, elevator, completion_handler')
    .eq('status', '처리중')
    .not('confirmed_at', 'is', null)
    .lt('confirmed_at', threshold);

  if (!reports?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  let sent = 0;
  for (const r of reports) {
    if (!r.completion_handler) continue;
    await fetch(`${SUPABASE_URL}/functions/v1/smooth-responder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        handlerName: r.completion_handler,
        title: '🚨 피드백 미처리 알림',
        body: `${r.building} ${r.elevator} 피드백을 입력하고 완료처리 해주세요.`,
        reportId: r.id,
        type: 'feedback'
      })
    }).catch(() => {});
    sent++;
  }

  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
