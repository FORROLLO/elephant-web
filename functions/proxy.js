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
    return new Response('No se pudo cargar el sitio (' + e.message + ')', { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    const headers = new Headers(upstream.headers);
    headers.delete('x-frame-options');
    headers.delete('content-security-policy');
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  class MediaButton {
    constructor(kind) {
      this.kind = kind;
    }
    element(el) {
      const raw = el.getAttribute('src');
      if (!raw) return;
      let abs;
      try {
        abs = new URL(raw, targetUrl).toString();
      } catch (e) {
        return;
      }
      const icon =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F2F0FA" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>';

      el.before(
        '<span class="elephant-media-wrap" style="position:relative;display:inline-block;max-width:100%;">',
        { html: true }
      );
      el.after(
        '<button type="button" class="elephant-dl-btn" data-elephant-url="' +
          escapeAttr(abs) +
          '" data-elephant-kind="' +
          this.kind +
          '" style="position:absolute;bottom:6px;right:6px;background:rgba(13,10,26,0.85);' +
          'border:none;border-radius:8px;width:32px;height:32px;display:flex;align-items:center;' +
          'justify-content:center;cursor:pointer;z-index:2147483647;">' +
          icon +
          '</button></span>',
        { html: true }
      );
    }
  }

  class VideoSourceButton {
    element(el) {
      const raw = el.getAttribute('src');
      if (!raw) return;
      let abs;
      try {
        abs = new URL(raw, targetUrl).toString();
      } catch (e) {
        return;
      }
      el.setAttribute('data-elephant-source-url', abs);
    }
  }

  const basePath = targetUrl.origin + targetUrl.pathname.replace(/[^/]*$/, '');

  const injectedScript = `
<script>
(function () {
  function toAbsolute(href) {
    try { return new URL(href, document.baseURI).href; } catch (e) { return null; }
  }

  document.addEventListener('click', function (e) {
    var dlBtn = e.target.closest('.elephant-dl-btn');
    if (dlBtn) {
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage(
        { type: 'elephant-download', url: dlBtn.getAttribute('data-elephant-url'), kind: dlBtn.getAttribute('data-elephant-kind') },
        '*'
      );
      dlBtn.style.background = 'rgba(140,124,240,0.95)';
      setTimeout(function () { dlBtn.style.background = 'rgba(13,10,26,0.85)'; }, 400);
      return;
    }

    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
    var abs = toAbsolute(href);
    if (!abs) return;
    e.preventDefault();
    var newWindow = link.getAttribute('target') === '_blank';
    window.parent.postMessage({ type: 'elephant-navigate', url: abs, newWindow: newWindow }, '*');
  }, true);

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get') return;
    e.preventDefault();
    var action = form.getAttribute('action') || document.baseURI;
    var abs = toAbsolute(action);
    if (!abs) return;
    var url = new URL(abs);
    new FormData(form).forEach(function (value, key) { url.searchParams.set(key, value); });
    window.parent.postMessage({ type: 'elephant-navigate', url: url.href }, '*');
  }, true);
})();
</script>`;

  const rewriter = new HTMLRewriter()
    .on('img', new MediaButton('img'))
    .on('video', new MediaButton('video'))
    .on('video source', new VideoSourceButton())
    .on('head', {
      element(el) {
        el.append('<base href="' + escapeAttr(basePath) + '">', { html: true });
      },
    })
    .on('body', {
      element(el) {
        el.append(injectedScript, { html: true });
      },
    });

  const rewritten = rewriter.transform(upstream);
  const headers = new Headers(rewritten.headers);
  headers.delete('x-frame-options');
  headers.delete('content-security-policy');
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(rewritten.body, { status: upstream.status, headers });
}
