import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const OLD_KEY = 'c6e435c47faeefcf40523c23655d6b5c5cab178dec7457eeb696d06473d71ea0';
    const NEW_KEY = 'ec060d89458664bd9f339a514fc44b1c5780f427ff0157fb2456524538686669';

    const body = await req.json();
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const BATCH = 50;
    const DELAY_MS = 80;   // 호출 몰아치기 차단 회피용 간격
    const offset = body.offset ?? 0;

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // order 고정 — 없으면 UPDATE 중 행 순서가 바뀌어 일부 호기가 누락/중복 처리됨
    const { data: elevators } = await db
      .from('site_elevators')
      .select('id, site_id, elevator_number, unit_name')
      .not('elevator_number', 'is', null)
      .order('id')
      .range(offset, offset + BATCH - 1);

    if (!elevators?.length) {
      return new Response(JSON.stringify({ updated: 0, skipped: 0, done: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const parseTag = (xml: string, tag: string) => {
      const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : null;
    };

    // 건물별 API는 elevator_no를 무시하고 건물의 모든 승강기를 반환한다.
    // 첫 <item>을 그냥 읽으면 항상 1호기 값이 들어가므로, 승강기번호가 일치하는 블록만 골라낸다.
    const pickItem = (xml: string, elevNo: string) => {
      const items = xml.match(/<item>[\s\S]*?<\/item>/g);
      if (!items) return '';
      return items.find(it => new RegExp(`<elevatorNo>\\s*${elevNo}\\s*</elevatorNo>`).test(it)) || '';
    };

    const fmtDate = (v: string | null) => {
      if (!v) return null;
      if (/^\d{8}$/.test(v)) return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      return null;
    };

    const updatedSiteLocations = new Set<number>();
    // 건물 API 응답은 현장당 1번만 받아 재사용한다 (35대 현장이면 35번 → 1번)
    const buldXmlCache = new Map<number, string>();

    let updated = 0;
    let skipped = 0;
    let logged = 0;

    for (const elev of elevators) {
      const no = (elev.elevator_number || '').replace(/-/g, '');
      if (!no) continue;

      let newXml = '';
      try {
        const newRes = await fetch(`https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorViewM?serviceKey=${NEW_KEY}&pageNo=1&numOfRows=1&type=xml&elevator_no=${no}`);
        newXml = await newRes.text();
        if (!newRes.ok && logged < 5) {
          logged++;
          console.log(`[sync] ${no} HTTP ${newRes.status} ${newXml.slice(0, 200)}`);
        }
      } catch (e: any) {
        if (logged < 5) { logged++; console.log(`[sync] ${no} fetch 실패: ${e.message}`); }
      }

      // 승강기 조회 API가 정상 응답하지 않으면 이 호기는 건드리지 않고 넘어간다.
      // (예전엔 여기서 건물 API 값으로 fallback 해서 모든 호기가 1호기 값으로 덮였음)
      if (parseTag(newXml, 'resultCode') !== '00' || !parseTag(newXml, 'elevatorNo')) {
        skipped++;
        if (logged < 5) {
          logged++;
          console.log(`[sync] skip ${no} · code=${parseTag(newXml, 'resultCode')} msg=${parseTag(newXml, 'resultMsg')} · ${newXml.slice(0, 300)}`);
        }
        await sleep(DELAY_MS);
        continue;
      }

      const update: Record<string, any> = {};
      const model     = parseTag(newXml, 'elvtrModel');
      const inspDate  = fmtDate(parseTag(newXml, 'applcEnDt'));
      const install   = fmtDate(parseTag(newXml, 'frstInstallationDe'));
      const addr1     = parseTag(newXml, 'address1');
      const addr2     = parseTag(newXml, 'address2');
      const asignNo   = parseTag(newXml, 'elvtrAsignNo');
      const kindNm    = parseTag(newXml, 'elvtrKindNm');
      const instPlace = parseTag(newXml, 'installationPlace');

      // 검사결과는 건물 API의 resultNm만 공단 검사이력과 일치한다.
      // (신규 API의 lastResultNm은 보완 완료 후에도 '조건후합격'으로 남아 실제와 다름)
      let oldXml = buldXmlCache.get(elev.site_id);
      if (oldXml === undefined) {
        try {
          const oldRes = await fetch(`https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList?serviceKey=${OLD_KEY}&pageNo=1&numOfRows=100&type=xml&elevator_no=${no}`);
          oldXml = await oldRes.text();
        } catch {
          oldXml = '';
        }
        buldXmlCache.set(elev.site_id, oldXml);
      }
      const oldItem = oldXml ? pickItem(oldXml, no) : '';
      const result  = oldItem ? parseTag(oldItem, 'resultNm') : null;

      if (model)    update.elevator_model          = model;
      if (inspDate) update.inspection_due_date      = inspDate;
      if (result)   update.last_inspection_result   = result;
      if (install)  update.install_date             = install;
      if (asignNo) {
        const n = parseInt(asignNo, 10);
        if (!isNaN(n)) update.assign_no = n;
      }
      if (kindNm) update.kind_name = kindNm;
      if (instPlace) update.installation_place = instPlace;

      if (update.assign_no && update.kind_name) {
        update.unit_name = update.assign_no + ' ' + update.kind_name;
      }

      if (Object.keys(update).length > 0) {
        await db.from('site_elevators').update(update).eq('id', elev.id);
        updated++;
      }

      const loc = [addr1, addr2].filter(Boolean).join(' ').trim();
      if (loc && !updatedSiteLocations.has(elev.site_id)) {
        await db.from('managed_sites')
          .update({ elevator_address: loc })
          .eq('id', elev.site_id)
          .is('elevator_address', null);
        updatedSiteLocations.add(elev.site_id);
      }

      await sleep(DELAY_MS);
    }

    console.log(`[sync] offset=${offset} updated=${updated} skipped=${skipped} buldCalls=${buldXmlCache.size}`);

    const done = elevators.length < BATCH;
    return new Response(JSON.stringify({ updated, skipped, done, next: offset + BATCH }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
