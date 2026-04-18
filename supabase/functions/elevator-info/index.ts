Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const SERVICE_KEY = 'c6e435c47faeefcf40523c23655d6b5c5cab178dec7457eeb696d06473d71ea0';
  const url = new URL(req.url);
  const elevatorNo = url.searchParams.get('elevator_no') || '';
  if (!elevatorNo) return new Response(JSON.stringify({ error: 'elevator_no required' }), { headers: cors });

  const apiUrl = 'https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList'
    + '?serviceKey=' + SERVICE_KEY + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevatorNo;

  try {
    const res = await fetch(apiUrl);
    const xml = await res.text();
    const get = (tag) => { const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>')); return m ? m[1].trim() : null; };
    if (get('resultCode') !== '00') return new Response(JSON.stringify({ error: 'api_error', code: get('resultCode') }), { headers: cors });
    if (!xml.includes('<item>')) return new Response(JSON.stringify({ error: 'no data' }), { headers: cors });
    const item = {
      buldNm: get('buldNm'),
      areaNm: get('areaNm'),
      sigunguNm: get('sigunguNm'),
      address1: get('address1'),
      address2: get('address2'),
      elevatorNo: get('elevatorNo'),
      elvtrAsignNo: get('elvtrAsignNo'),
      elvtrDivNm: get('elvtrDivNm'),
      elvtrKindNm: get('elvtrKindNm'),
      elvtrDetailForm: get('elvtrDetailForm'),
      elvtrForm: get('elvtrForm'),
      elvtrSttsNm: get('elvtrSttsNm'),
      ratedCap: get('ratedCap'),
      liveLoad: get('liveLoad'),
      shuttleSection: get('shuttleSection'),
      shuttleFloorCnt: get('shuttleFloorCnt'),
      groundFloorCnt: get('groundFloorCnt'),
      undgrndFloorCnt: get('undgrndFloorCnt'),
      installationPlace: get('installationPlace'),
      frstInstallationDe: get('frstInstallationDe'),
      installationDe: get('installationDe'),
      applcBeDt: get('applcBeDt'),
      applcEnDt: get('applcEnDt'),
      resultNm: get('resultNm'),
    };
    return new Response(JSON.stringify({ item }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: cors });
  }
});
