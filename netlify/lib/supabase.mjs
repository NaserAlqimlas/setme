// Server-side Supabase calls with the secret key. Never import this from the site.
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function call(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: KEY, 'content-type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.msg || body?.message || body?.error_description || `Supabase ${res.status}`);
  return body;
}

export const rest = (path, init) => call(`/rest/v1/${path}`, init);
export const authAdmin = (path, init) => call(`/auth/v1/admin/${path}`, init);

// The signed-in user making the request, with their role, or null.
export async function caller(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
  if (!token || !URL_ || !KEY) return null;
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const user = await res.json();
  const [profile] = await rest(`profiles?id=eq.${user.id}&select=role,email,display_name`);
  return profile ? { id: user.id, ...profile } : null;
}
