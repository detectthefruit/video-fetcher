const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { pipeline } = require('node:stream/promises');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_REDIRECTS = 5;

function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    const [first, second] = octets;
    return !(
      first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized.startsWith('2') || normalized.startsWith('3');
  }

  return false;
}

async function validateDestination(url) {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS video URLs are supported.');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not supported.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('This address is not publicly routable.');
  }

  return addresses;
}

async function openUpstream(url) {
  const addresses = await validateDestination(url);
  const selectedAddress = addresses[0].address;
  const family = net.isIP(selectedAddress);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.get(url, {
      lookup: (_hostname, options, callback) => {
        const result = { address: selectedAddress, family };
        callback(null, options.all ? [result] : selectedAddress, family);
      },
      headers: {
        'User-Agent': 'VideoFetcher/1.0',
        Accept: 'video/*, application/octet-stream;q=0.9, */*;q=0.5',
      },
      timeout: 30_000,
    }, resolve);
    request.on('timeout', () => request.destroy(new Error('The source took too long to respond.')));
    request.on('error', reject);
  });
}

async function fetchVideo(initialUrl, response) {
  let currentUrl = initialUrl;
  let upstream;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    upstream = await openUpstream(currentUrl);
    if (![301, 302, 303, 307, 308].includes(upstream.statusCode)) break;

    const location = upstream.headers.location;
    upstream.resume();
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new Error('The source redirected too many times.');
    }
    currentUrl = new URL(location, currentUrl);
  }

  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    upstream.resume();
    throw new Error(`The source returned HTTP ${upstream.statusCode}.`);
  }

  const contentType = upstream.headers['content-type'] || 'application/octet-stream';
  const normalizedContentType = contentType.toLowerCase();
  if (!normalizedContentType.startsWith('video/') && normalizedContentType !== 'application/octet-stream') {
    upstream.resume();
    throw new Error('The URL did not return a video file.');
  }

  const filename = path.posix.basename(decodeURIComponent(currentUrl.pathname)) || 'video';
  const safeFilename = filename.replace(/[^\x20-\x7E]|["\\/]/g, '_').slice(0, 180);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    ...(upstream.headers['content-length'] ? { 'Content-Length': upstream.headers['content-length'] } : {}),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  await pipeline(upstream, response);
}

function sendJson(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify({ error: message }));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/download' && request.method === 'GET') {
    const source = requestUrl.searchParams.get('url');
    if (!source || source.length > 4096) {
      sendJson(response, 400, 'Enter a valid video URL.');
      return;
    }

    try {
      await fetchVideo(new URL(source), response);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 400, error instanceof TypeError ? 'Enter a valid video URL.' : error.message);
      } else {
        response.destroy(error);
      }
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }

  const filePath = requestUrl.pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, requestUrl.pathname);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    const contentType = filePath.endsWith('.css') ? 'text/css' : filePath.endsWith('.js') ? 'text/javascript' : 'text/html';
    response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    response.end(request.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Video Fetcher is running at http://localhost:${PORT}`);
});