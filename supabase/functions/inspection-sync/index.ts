import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const API_KEY = 'c6e435c47faeefcf40523c23655d6b5c5cab178dec7457eeb696d06473d71ea0';

    const body = await req.json();
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const BATCH = 50;
    const offset = body.offset ?? 0;

    const { data: elevators } = await db
      .from('site_elevators')
      .select('id, site_id, elevator_number, unit_name')
      .not('elevator_number', 'is', null)
      .range(offset, offset + BATCH - 1);

    if (!elevators?.length) {
      return new Response(JSON.stringify({ updated: 0, done: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const parseTag = (xml: string, tag: string) => {
      const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : null;
    };

    const fmtDate = (v: string | null) => {
      if (!v) return null;
      if (/^\d{8}$/.test(v)) return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      return null;
    };

    const updatedSiteLocations = new Set<number>();

    let updated = 0;
    for (const elev of elevators) {
      const no = (elev.elevator_number || '').replace(/-/g, '');
      if (!no) continue;

      const res = await fetch(`https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList?serviceKey=${API_KEY}&pageNo=1&numOfRows=1&type=xml&elevator_no=${no}`);
      const xml = await res.text();

      const update: Record<string, any> = {};
      const model    = parseTag(xml, 'elvtrModel');
      const inspDate = fmtDate(parseTag(xml, 'applcEnDt'));
      const result   = parseTag(xml, 'resultNm');
      const install  = fmtDate(parseTag(xml, 'frstInstallationDe'));
      const addr1    = parseTag(xml, 'address1');
      const addr2    = parseTag(xml, 'address2');
      const buldNm   = parseTag(xml, 'buldNm');
      const asignNo  = parseTag(xml, 'elvtrAsignNo');
      const kindNm   = parseTag(xml, 'elvtrKindNm');

      if (model)    update.elevator_model         = model;
      if (inspDate) update.inspection_due_date     = inspDate;
      if (result)   update.last_inspection_result  = result;
      if (install)  update.install_date            = install;
      if (asignNo) {
        const n = parseInt(asignNo, 10);
        if (!isNaN(n)) update.assign_no = n;
      }
      if (kindNm) update.kind_name = kindNm;

      // unit_name: assign_no + kind_name 우선, 없으면 buldNm fallback
      if (update.assign_no && update.kind_name) {
        update.unit_name = update.assign_no + ' ' + update.kind_name;
      } else if (buldNm && !elev.unit_name) {
        update.unit_name = buldNm;
      }

      if (Object.keys(update).length > 0) {
        await db.from('site_elevators').update(update).eq('id', elev.id);
        updated++;
      }

      // managed_sites.elevator_address 업데이트 (현장당 한 번만, 비어있는 경우에만)
      const loc = [addr1, addr2].filter(Boolean).join(' ').trim();
      if (loc && !updatedSiteLocations.has(elev.site_id)) {
        await db.from('managed_sites')
          .update({ elevator_address: loc })
          .eq('id', elev.site_id)
          .is('elevator_address', null);
        updatedSiteLocations.add(elev.site_id);
      }
    }

    const done = elevators.length < BATCH;
    return new Response(JSON.stringify({ updated, done, next: offset + BATCH }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
