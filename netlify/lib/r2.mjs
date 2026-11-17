// Cloudflare R2 (S3-compatible storage) for game videos, signed with AWS Signature V4 by hand so the functions need
// no packages. Server side only: the secret key never reaches the browser, which gets short-lived signed links.
//   originals/<job>/<file>   the upload as recorded; deleted 7 days after analysis (video-cleanup)
//   viewing/<job>.mp4        the 720p copy people watch; kept
//   reels/<reel>.mp4         a highlight reel made into one file; replaced when it's made again
// Environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (and R2_ENDPOINT only for tests).
import { createHash, createHmac } from 'node:crypto';

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha = b => createHash('sha256').update(b ?? '').digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const amzDate = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20130524T000000Z
const canonicalPath = p => p.split('/').map(enc).join('/');
const canonicalQuery = q => Object.keys(q).sort().map(k => `${enc(k)}=${enc(String(q[k]))}`).join('&');

export const signingKey = (secret, day, region, service = 's3') =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');

// A link anyone can use until it expires: GET to watch or download, PUT to upload (a whole file or one part).
export function presign({ method, host, path, query = {}, region, accessKey, secret, expires = 3600, now = new Date(), protocol = 'https:' }) {
  const date = amzDate(now), day = date.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const q = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': date, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const request = [method, canonicalPath(path), canonicalQuery(q), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha(request)].join('\n');
  const sig = createHmac('sha256', signingKey(secret, day, region)).update(toSign).digest('hex');
  return `${protocol}//${host}${canonicalPath(path)}?${canonicalQuery(q)}&X-Amz-Signature=${sig}`;
}

// The headers for a request signed in the Authorization header (for calls made from here, not handed out).
export function signHeaders({ method, host, path, query = {}, headers = {}, body = '', region, accessKey, secret, now = new Date() }) {
  const date = amzDate(now), day = date.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
    host, 'x-amz-content-sha256': sha(body), 'x-amz-date': date };
  const names = Object.keys(all).sort();
  const request = [method, canonicalPath(path), canonicalQuery(query), names.map(n => `${n}:${all[n]}\n`).join(''), names.join(';'), all['x-amz-content-sha256']].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha(request)].join('\n');
  const sig = createHmac('sha256', signingKey(secret, day, region)).update(toSign).digest('hex');
  const { host: _h, ...send } = all;
  return { ...send, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

// The bucket, or null when R2 isn't set up yet (the functions then say so instead of failing oddly).
export function r2(env = process.env, fetcher = (...a) => fetch(...a)) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !(R2_ACCOUNT_ID || R2_ENDPOINT)) return null;
  const base = new URL(R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  const auth = { host: base.host, region: 'auto', accessKey: R2_ACCESS_KEY_ID, secret: R2_SECRET_ACCESS_KEY };
  const path = key => `${base.pathname.replace(/\/$/, '')}/${R2_BUCKET}/${key}`;
  const call = async (method, key, query = {}, body = '', headers = {}) => {
    const qs = canonicalQuery(query);
    const res = await fetcher(`${base.protocol}//${base.host}${canonicalPath(path(key))}${qs ? `?${qs}` : ''}`,
      { method, body: body || undefined, headers: signHeaders({ ...auth, method, path: path(key), query, headers, body }) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Storage ${res.status}: ${tag(text, 'Message') ?? tag(text, 'Code') ?? text.slice(0, 120)}`);
    return text;
  };
  const link = (method, key, query, expires) => presign({ ...auth, method, path: path(key), query, expires, protocol: base.protocol });
  return {
    // Watch or download for `expires` seconds. download: a file name, so the browser saves it rather than plays it.
    getUrl: (key, expires = 6 * 3600, download) => link('GET', key,
      download ? { 'response-content-disposition': `attachment; filename="${String(download).replace(/[^\w. -]+/g, '_')}"` } : {}, expires),
    // Upload a whole file (up to 5 GB) with one PUT.
    putUrl: (key, expires = 6 * 3600) => link('PUT', key, {}, expires),
    // Big uploads go in parts, so a dropped connection only resends one part.
    async startUpload(key, contentType = 'application/octet-stream') {
      const id = tag(await call('POST', key, { uploads: '' }, '', { 'content-type': contentType }), 'UploadId');
      if (!id) throw new Error('Storage did not start the upload');
      return id;
    },
    partUrl: (key, uploadId, n, expires = 6 * 3600) => link('PUT', key, { partNumber: n, uploadId }, expires),
    async finishUpload(key, uploadId, parts) {
      const xml = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.n - b.n)
        .map(p => `<Part><PartNumber>${p.n}</PartNumber><ETag>${String(p.etag).replace(/[<>&]/g, '')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      await call('POST', key, { uploadId }, xml, { 'content-type': 'application/xml' });
    },
    abortUpload: (key, uploadId) => call('DELETE', key, { uploadId }).then(() => {}),
    remove: key => call('DELETE', key).then(() => {}),
  };
}
