import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const API_KEY = 'ec060d89458664bd9f339a514fc44b1c5780f427ff0157fb2456524538686669';

function getTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
  return m ? m[1].trim() : null;
}

async function fetchModel(elevNo: string): Promise<string | null> {
  try {
    const url = 'https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorViewM'
      + '?serviceKey=' + API_KEY + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevNo;
    const res = await fetch(url);
    const xml = await res.text();
    return getTag(xml, 'elvtrModel');
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // 모델명 없는 호기만 조회
    const { data: elevators, error } = await db
      .from('site_elevators')
      .select('id, elevator_number')
      .is('elevator_model', null)
      .not('elevator_number', 'is', null);

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
    if (!elevators?.length) return new Response(JSON.stringify({ ok: true, updated: 0, message: '업데이트할 항목 없음' }), { headers: cors });

    let updated = 0;
    const BATCH = 5;

    for (let i = 0; i < elevators.length; i += BATCH) {
      const batch = elevators.slice(i, i + BATCH);
      await Promise.all(batch.map(async (e) => {
        const no = (e.elevator_number || '').replace(/-/g, '');
        if (no.length < 7) return;
        const model = await fetchModel(no);
        if (!model) return;
        await db.from('site_elevators').update({ elevator_model: model }).eq('id', e.id);
        updated++;
      }));
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[sync-elevator-models] 완료: ${updated}/${elevators.length}개 업데이트`);
    return new Response(JSON.stringify({ ok: true, updated, total: elevators.length }), { headers: cors });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
});
