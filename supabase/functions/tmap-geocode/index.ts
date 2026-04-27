Deno.serve(async (req) => {
  const { address } = await req.json();
  if (!address) return new Response(JSON.stringify({ error: 'no address' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const TMAP_KEY = Deno.env.get('TMAP_API_KEY')!;
  const url = `https://apis.openapi.sk.com/tmap/geo/geocoding?version=1&format=json&appKey=${TMAP_KEY}&addressFlag=F02&fullAddr=${encodeURIComponent(address)}`;

  const res = await fetch(url);
  const data = await res.json();

  const coord = data?.coordinateInfo?.coordinate?.[0];
  if (!coord?.lon || !coord?.lat) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify({ lon: coord.lon, lat: coord.lat }), { headers: { 'Content-Type': 'application/json' } });
});
