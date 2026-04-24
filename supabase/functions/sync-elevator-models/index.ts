import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const API_KEY     = 'ec060d89458664bd9f339a514fc44b1c5780f427ff0157fb2456524538686669';
const API_KEY_OLD = 'c6e435c47faeefcf40523c23655d6b5c5cab178dec7457eeb696d06473d71ea0';

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
  } catch { return null; }
}

async function fetchLastInspection(elevNo: string): Promise<string | null> {
  try {
    const url = 'https://apis.data.go.kr/B553664/ElevatorInformationService/getElvtrInspctInqireM'
      + '?serviceKey=' + API_KEY + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevNo;
    const res = await fetch(url);
    const xml = await res.text();
    return getTag(xml, 'psexamYn');
  } catch { return null; }
}

async function fetchInspectionScheduled(elevNo: string): Promise<string | null> {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const url = 'https://apis.data.go.kr/B553664/ElevatorRecptnService/getRecptnV1'
      + '?serviceKey=' + API_KEY_OLD + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevNo
      + '&inspct_st_de=' + today;
    const res = await fetch(url);
    const xml = await res.text();
    const dt = getTag(xml, 'inspctDt');
    if (!dt || dt.length !== 8) return null;
    return dt.slice(0, 4) + '-' + dt.slice(4, 6) + '-' + dt.slice(6, 8);
  } catch { return null; }
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: elevators, error } = await db
      .from('site_elevators')
      .select('id, elevator_number, elevator_model')
      .not('elevator_number', 'is', null);

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
    if (!elevators?.length) return new Response(JSON.stringify({ ok: true, updated: 0 }), { headers: cors });

    let modelUpdated = 0, inspUpdated = 0, schedUpdated = 0;
    const BATCH = 15;

    for (let i = 0; i < elevators.length; i += BATCH) {
      const batch = elevators.slice(i, i + BATCH);
      await Promise.all(batch.map(async (e) => {
        const no = (e.elevator_number || '').replace(/-/g, '');
        if (no.length < 7) return;

        const patch: Record<string, string | null> = {};

        // 모델명 없는 경우만 업데이트
        if (!e.elevator_model) {
          const model = await fetchModel(no);
          if (model) { patch.elevator_model = model; modelUpdated++; }
        }

        // 최근 검사결과 + 검사예정일 병렬 조회
        const [result, scheduled] = await Promise.all([
          fetchLastInspection(no),
          fetchInspectionScheduled(no),
        ]);

        if (result) { patch.last_inspection_result = result; inspUpdated++; }
        patch.next_inspection_scheduled = scheduled;
        if (scheduled) schedUpdated++;

        if (Object.keys(patch).length > 0) {
          await db.from('site_elevators').update(patch).eq('id', e.id);
        }
      }));
      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`[sync] 모델: ${modelUpdated}, 검사결과: ${inspUpdated}, 검사예정일: ${schedUpdated}`);
    return new Response(JSON.stringify({ ok: true, modelUpdated, inspUpdated, schedUpdated }), { headers: cors });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
});
