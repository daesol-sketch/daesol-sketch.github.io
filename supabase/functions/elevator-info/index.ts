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

  try {
    // 새 API: 상세정보 (elvtrModel 포함)
    const newUrl = 'https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorViewM'
      + '?serviceKey=' + NEW_KEY + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevatorNo;
    const newRes = await fetch(newUrl);
    const newXml = await newRes.text();

    // 기존 API: 보조 정보
    const oldUrl = 'https://apis.data.go.kr/B553664/BuldElevatorService/getBuldElvtrList'
      + '?serviceKey=' + OLD_KEY + '&pageNo=1&numOfRows=1&type=xml&elevator_no=' + elevatorNo;
    const oldRes = await fetch(oldUrl);
    const oldXml = await oldRes.text();

    if (get(newXml, 'resultCode') !== '00' && get(oldXml, 'resultCode') !== '00') {
      return new Response(JSON.stringify({ error: 'api_error' }), { headers: cors });
    }

    const item = {
      buldNm:           get(newXml, 'buldNm')           || get(oldXml, 'buldNm'),
      address1:         get(newXml, 'address1')         || get(oldXml, 'address1'),
      address2:         get(newXml, 'address2')         || get(oldXml, 'address2'),
      areaNm:           get(oldXml, 'areaNm'),
      sigunguNm:        get(oldXml, 'sigunguNm'),
      elevatorNo:       get(newXml, 'elevatorNo')       || get(oldXml, 'elevatorNo'),
      elvtrAsignNo:     get(newXml, 'elvtrAsignNo')     || get(oldXml, 'elvtrAsignNo'),
      elvtrDivNm:       get(newXml, 'elvtrDivNm')       || get(oldXml, 'elvtrDivNm'),
      elvtrKindNm:      get(newXml, 'elvtrKindNm')      || get(oldXml, 'elvtrKindNm'),
      elvtrModel:       get(newXml, 'elvtrModel'),
      elvtrFormNm:      get(newXml, 'elvtrFormNm'),
      elvtrDetailForm:  get(oldXml, 'elvtrDetailForm'),
      elvtrForm:        get(oldXml, 'elvtrForm'),
      elvtrSttsNm:      get(newXml, 'elvtrStts')        || get(oldXml, 'elvtrSttsNm'),
      ratedCap:         get(oldXml, 'ratedCap'),
      liveLoad:         get(oldXml, 'liveLoad'),
      shuttleSection:   get(oldXml, 'shuttleSection'),
      shuttleFloorCnt:  get(oldXml, 'shuttleFloorCnt'),
      groundFloorCnt:   get(newXml, 'divGroundFloorCnt') || get(oldXml, 'groundFloorCnt'),
      undgrndFloorCnt:  get(newXml, 'divUndgrndFloorCnt') || get(oldXml, 'undgrndFloorCnt'),
      installationPlace: get(oldXml, 'installationPlace'),
      frstInstallationDe: get(oldXml, 'frstInstallationDe'),
      installationDe:   get(oldXml, 'installationDe'),
      applcBeDt:        get(newXml, 'applcBeDt')        || get(oldXml, 'applcBeDt'),
      applcEnDt:        get(newXml, 'applcEnDt')        || get(oldXml, 'applcEnDt'),
      resultNm:         get(oldXml, 'resultNm'),
    };

    return new Response(JSON.stringify({ item }), { headers: cors });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { headers: cors });
  }
});
