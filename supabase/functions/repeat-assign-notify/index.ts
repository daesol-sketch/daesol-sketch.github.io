const SUPABASE_URL = 'https://bbnmxwpacdfqvicybhau.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I';

Deno.serve(async () => {
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/reports?status=eq.배치완료&created_at=lt.${encodeURIComponent(threshold)}&select=id,building,elevator,completion_handler`,
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
        title: '🔧 고장 신고 배정',
        body: `${r.building} ${r.elevator} 고장 신고가 배정되었습니다.`,
        reportId: r.id
      })
    }).catch(() => {});
    sent++;
  }

  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
