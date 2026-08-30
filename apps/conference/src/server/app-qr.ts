import QRCode from 'qrcode';

export const CANONICAL_APP_QR_PAYLOAD = 'https://app.byzon.cz' as const;

export const createCanonicalAppQrSvg = async (
  encode: typeof QRCode.toString = QRCode.toString,
): Promise<string> => {
  const svg = await encode(CANONICAL_APP_QR_PAYLOAD, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,
    color: { dark: '#512a7a', light: '#ffffff' },
  });
  return svg
    .replace(
      /<svg\b/,
      '<svg role="img" aria-labelledby="app-qr-title" data-byzon-qr-kind="general-app"',
    )
    .replace(
      />/,
      '><title id="app-qr-title">Obecný QR aplikace BYZON — nejde o vstupenku ani session QR</title>',
    );
};

export const readCanonicalAppQr = async (
  request: Request,
): Promise<Response> => {
  if (request.method !== 'GET' || new URL(request.url).search.length > 0) {
    return new Response(null, {
      status: 404,
      headers: { 'cache-control': 'public, max-age=300' },
    });
  }
  return new Response(await createCanonicalAppQrSvg(), {
    headers: {
      'cache-control': 'public, max-age=86400, immutable',
      'content-disposition': 'inline; filename="byzon-app-qr-general.svg"',
      'content-type': 'image/svg+xml; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
};
