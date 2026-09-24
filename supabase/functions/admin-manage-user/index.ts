// Gringolês — admin-manage-user (service_role, só admin).
// POST { action: "block" | "unblock" | "delete", userId } → { ok: true }
// - block: ban no Auth (ban_duration longa) + profiles.is_blocked=true (derruba sessão na hora)
// - unblock: remove ban + is_blocked=false
// - delete: auth.admin.deleteUser (profiles/cards/study_days caem por FK cascade)
// O admin não pode agir sobre a própria conta.

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

  let body: { action?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const action = String(body?.action ?? '');
  const userId = String(body?.userId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ ok: false, error: 'invalid userId' }, 400);
  if (userId === callerData.user.id) return json({ ok: false, error: 'cannot act on yourself' }, 400);

  if (action === 'block') {
    const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    if (banErr) return json({ ok: false, error: banErr.message }, 400);
    const { error: flagErr } = await admin.from('profiles').update({ is_blocked: true }).eq('id', userId);
    if (flagErr) return json({ ok: false, error: flagErr.message }, 400);
    return json({ ok: true });
  }
  if (action === 'unblock') {
    const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (banErr) return json({ ok: false, error: banErr.message }, 400);
    const { error: flagErr } = await admin.from('profiles').update({ is_blocked: false }).eq('id', userId);
    if (flagErr) return json({ ok: false, error: flagErr.message }, 400);
    return json({ ok: true });
  }
  if (action === 'delete') {
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json({ ok: false, error: delErr.message }, 400);
    return json({ ok: true });
  }
  return json({ ok: false, error: 'unknown action' }, 400);
});
