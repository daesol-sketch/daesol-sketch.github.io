Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const OLD_KEY = 'c6e435c47faeefcf40523c23655d6b5c5cab178dec7457eeb696d06473d71ea0';
  const NEW_KEY = 'ec060d89458664bd9f339a514fc44b1c5780f427ff0157fb2456524538686669';
  const url = new URL(req.url);
  const elevatorNo = url.searchParams.get('elevator_no') || '';
  if (!elevatorNo) return new Response(JSON.stringify({ error: 'elevator_no required' }), { headers: cors });

  const get = (xml: string, tag: string) => {
    const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
    return m ? m[1].trim() : null;
  };

  // 건물별 API(getBuldElvtrList)는 elevator_no를 무시하고 건물의 모든 승강기를 반환한다.
  // 첫 <item>을 그냥 읽으면 항상 1호기 값이 들어가므로, 승강기번호가 일치하는 블록만 골라낸다.
  const pickItem = (xml: string, elevNo: string) => {
    const items = xml.match(/<item>[\s\S]*?<\/item>/g);
    if (!items) return '';
    return items.find(it => new RegExp('<elevatorNo>\\s*' + elevNo + '\\s*<\\/elevatorNo>').test(it)) || '';
  };

  try {
    // 새 API: 상세정보 (elvtrModel 포함) — 승강기 1대만 정확히 반환
    const newUrl = 'https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorViewM'
      + '?serviceKey=' + NEW_KEY + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevatorNo;
    const newRes = await fetch(newUrl);
    const newXml = await newRes.text();

    // 기존 API: 보조 정보 (검사결과·형식·용량 등). 건물 전체가 오므로 numOfRows를 넉넉히.
    const oldUrl = 'https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList'
      + '?serviceKey=' + OLD_KEY + '&pageNo=1&numOfRows=100&type=xml&elevator_no=' + elevatorNo;
    const oldRes = await fetch(oldUrl);
    const oldXml = await oldRes.text();

    if (get(newXml, 'resultCode') !== '00' && get(oldXml, 'resultCode') !== '00') {
      return new Response(JSON.stringify({ error: 'api_error' }), { headers: cors });
    }

    // 해당 승강기의 item 블록만 사용 (없으면 빈 문자열 → 값 없음 처리)
    const oldItem = pickItem(oldXml, elevatorNo);

    const item = {
      buldNm:           get(newXml, 'buldNm')           || get(oldItem, 'buldNm'),
      address1:         get(newXml, 'address1')         || get(oldItem, 'address1'),
      address2:         get(newXml, 'address2')         || get(oldItem, 'address2'),
      areaNm:           get(oldItem, 'areaNm'),
      sigunguNm:        get(oldItem, 'sigunguNm'),
      elevatorNo:       get(newXml, 'elevatorNo')       || get(oldItem, 'elevatorNo'),
      elvtrAsignNo:     get(newXml, 'elvtrAsignNo')     || get(oldItem, 'elvtrAsignNo'),
      elvtrDivNm:       get(newXml, 'elvtrDivNm')       || get(oldItem, 'elvtrDivNm'),
      elvtrKindNm:      get(newXml, 'elvtrKindNm')      || get(oldItem, 'elvtrKindNm'),
      elvtrModel:       get(newXml, 'elvtrModel'),
      elvtrFormNm:      get(newXml, 'elvtrFormNm'),
      elvtrDetailForm:  get(oldItem, 'elvtrDetailForm'),
      elvtrForm:        get(oldItem, 'elvtrForm'),
      elvtrSttsNm:      get(newXml, 'elvtrStts')        || get(oldItem, 'elvtrSttsNm'),
      ratedCap:         get(oldItem, 'ratedCap'),
      liveLoad:         get(oldItem, 'liveLoad'),
      shuttleSection:   get(oldItem, 'shuttleSection'),
      shuttleFloorCnt:  get(oldItem, 'shuttleFloorCnt'),
      groundFloorCnt:   get(newXml, 'divGroundFloorCnt')  || get(oldItem, 'groundFloorCnt'),
      undgrndFloorCnt:  get(newXml, 'divUndgrndFloorCnt') || get(oldItem, 'undgrndFloorCnt'),
      installationPlace: get(newXml, 'installationPlace') || get(oldItem, 'installationPlace'),
      frstInstallationDe: get(newXml, 'frstInstallationDe') || get(oldItem, 'frstInstallationDe'),
      installationDe:   get(newXml, 'installationDe')    || get(oldItem, 'installationDe'),
      applcBeDt:        get(newXml, 'applcBeDt')         || get(oldItem, 'applcBeDt'),
      applcEnDt:        get(newXml, 'applcEnDt')         || get(oldItem, 'applcEnDt'),
      resultNm:         get(oldItem, 'resultNm'),
    };

    return new Response(JSON.stringify({ item }), { headers: cors });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { headers: cors });
  }
});
