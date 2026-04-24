const SUPABASE_URL = 'https://bbnmxwpacdfqvicybhau.supabase.co';
const SUPABASE_ANON_KEY = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I`;

Deno.serve(async () => {
  // 한국 시간 23시 ~ 07시 사이엔 발송 안 함
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  if (kstHour >= 23 || kstHour < 7) {
    return new Response(JSON.stringify({ sent: 0, reason: 'quiet hours' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const threshold = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

  const enc = encodeURIComponent(threshold);
  const filter = 'status=eq.처리중&confirmed_at=lt.' + enc + '&select=id,building,elevator,completion_handler';

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/reports?${filter}`,
    { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  const reports = await res.json();
  if (!Array.isArray(reports)) return new Response(JSON.stringify({ error: 'db error' }), { status: 500 });

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
