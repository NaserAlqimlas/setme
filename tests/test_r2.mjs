// R2 signing: checked against the worked examples in Amazon's Signature V4 documentation, then the bucket calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presign, signHeaders, r2 } from '../netlify/lib/r2.mjs';

const AWS = { host: 'examplebucket.s3.amazonaws.com', region: 'us-east-1', accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z') };

test('a signed link matches Amazon\'s example', () => {
  const url = presign({ ...AWS, method: 'GET', path: '/test.txt', expires: 86400 });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('a signed request matches Amazon\'s example', () => {
  const h = signHeaders({ ...AWS, method: 'GET', path: '/test.txt', headers: { Range: 'bytes=0-9' } });
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('the bucket: uploads in parts, links, and nothing when not set up', async () => {
  assert.equal(r2({}), null);
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return new Response(url.includes('uploads=') ? '<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>' : '', { status: 200 });
  };
  const b = r2({ R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'setme' }, fake);
  assert.equal(await b.startUpload('originals/j1/IMG 1.MOV', 'video/quicktime'), 'up-1');
  assert.equal(calls[0].url, 'https://acct.r2.cloudflarestorage.com/setme/originals/j1/IMG%201.MOV?uploads=');
  const part = new URL(b.partUrl('originals/j1/IMG 1.MOV', 'up-1', 3));
  assert.equal(part.searchParams.get('partNumber'), '3');
  assert.equal(part.searchParams.get('uploadId'), 'up-1');
  assert.ok(part.searchParams.get('X-Amz-Signature'));
  await b.finishUpload('originals/j1/IMG 1.MOV', 'up-1', [{ n: 2, etag: '"b"' }, { n: 1, etag: '"a"' }]);
  assert.match(calls[1].body, /<PartNumber>1<\/PartNumber><ETag>"a"<\/ETag><\/Part><Part><PartNumber>2/);
  await assert.rejects(r2({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' },
    async () => new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 })).remove('x'), /Storage 404: NoSuchBucket/);
});
