export async function onRequestGet(context) {
  const { request } = context;
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('url');
  if (!target) return new Response('Falta el parámetro url', { status: 400 });

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (e) {
    return new Response('URL inválida', { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      headers: { 'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0' },
    });
  } catch (e) {
    return new Response('No se pudo descargar (' + e.message + ')', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response('El servidor de origen respondió ' + upstream.status, { status: upstream.status });
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(upstream.body, { status: 200, headers });
}
