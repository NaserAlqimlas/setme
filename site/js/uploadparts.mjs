// The bookkeeping of a video upload sent in parts (upload.mjs), kept apart so it can be tested.
// s: { name, size, lastModified, partBytes, done: { partNumber: etag } }

// The same file as the upload that stopped (so its parts already sent can be kept).
export const sameFile = (s, f) => !!s && s.name === f.name && s.size === f.size && s.lastModified === f.lastModified;
// Bytes in part n (every part is partBytes, except the last).
export const partLength = (s, n) => Math.max(0, Math.min(s.partBytes, s.size - (n - 1) * s.partBytes));
// How much of the file has been sent, 0 to 1.
export const sentShare = s => s?.size ? Math.min(1, Object.keys(s.done ?? {}).reduce((t, n) => t + partLength(s, Number(n)), 0) / s.size) : 0;
// The parts still to send.
export const todo = (parts, done) => parts.filter(p => !done[p.n]);
