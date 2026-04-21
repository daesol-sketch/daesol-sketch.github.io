const SUPABASE_URL = 'https://bbnmxwpacdfqvicybhau.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I';

Deno.serve(async () => {
  const threshold = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

  // confirmed_at 기준 8시간 초과 OR (confirmed_at 없고 created_at 기준 8시간 초과)
  const filter = `status=eq.처리중&or=(confirmed_at.lt.${encodeURIComponent(threshold)},and(confirmed_at.is.null,created_at.lt.${encodeURIComponent(threshold)}))&select=id,building,elevator,completion_handler`;

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
