// Gringolês — admin-create-user (service_role, só admin).
// POST { email, password, displayName } → { ok: true, userId }
// Cria o usuário com email_confirm=true + app_metadata.must_change_password,
// e marca profiles.must_change_password=true (o gate ChangePasswordGate força a troca).
// Sem e-mail de confirmação (decisão: Confirm OFF no dashboard).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ ok: false, error: 'missing env' }, 500);

  // Quem chama precisa ser admin (valida o JWT do Authorization).
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ ok: false, error: 'missing auth' }, 401);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: callerData, error: callerErr } = await caller.auth.getUser(jwt);
  if (callerErr || !callerData?.user) return json({ ok: false, error: 'invalid token' }, 401);
  const admin = createClient(url, serviceKey);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', callerData.user.id).single();
  if ((prof as { role?: string } | null)?.role !== 'admin') {
    return json({ ok: false, error: 'admin only' }, 403);
  }

  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const email = String(body?.email ?? '').trim();
  const password = String(body?.password ?? '');
  const displayName = String(body?.displayName ?? '').trim() || email.split('@')[0];
  if (!/.+@.+\..+/.test(email)) return json({ ok: false, error: 'invalid email' }, 400);
  if (password.length < 6) return json({ ok: false, error: 'weak password' }, 400);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: { must_change_password: true },
  });
  if (createErr || !created?.user) {
    return json({ ok: false, error: createErr?.message ?? 'create failed' }, 400);
  }
  await admin.from('profiles').update({ must_change_password: true }).eq('id', created.user.id);
  return json({ ok: true, userId: created.user.id });
});
