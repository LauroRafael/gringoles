// Gringolês — admin-manage-user (service_role, só admin).
// POST { action: "block" | "unblock" | "delete" | "list" | "reset-password", userId?, password? }
// - block: ban no Auth (ban_duration longa) + profiles.is_blocked=true (derruba sessão na hora)
// - unblock: remove ban + is_blocked=false
// - delete: auth.admin.deleteUser (profiles/cards/study_days caem por FK cascade)
// - list: devolve [{ id, email, ...profile }] (e-mail vem do Auth — profiles não tem e-mail)
// - reset-password: define nova senha + profiles.must_change_password=true (troca no 1º acesso)
// O admin não pode agir sobre a própria conta (exceto list).

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

  let body: { action?: string; userId?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const action = String(body?.action ?? '');

  // Lista todos os usuários com e-mail (Auth) + profile. Só admin.
  if (action === 'list') {
    const perPage = 200;
    let page = 1;
    const authUsers: { id: string; email?: string; created_at?: string }[] = [];
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return json({ ok: false, error: error.message }, 400);
      for (const u of data.users) authUsers.push({ id: u.id, email: u.email, created_at: u.created_at });
      if (data.users.length < perPage) break;
      page += 1;
      if (page > 10) break;
    }
    const ids = authUsers.map((u) => u.id);
    let profMap = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id,display_name,role,xp,created_at,is_blocked,must_change_password')
        .in('id', ids);
      if (pErr) return json({ ok: false, error: pErr.message }, 400);
      for (const p of (profs ?? []) as Record<string, unknown>[]) {
        profMap.set(String((p as { id: string }).id), p);
      }
    }
    const users = authUsers.map((u) => ({ ...u, profile: profMap.get(u.id) ?? null }));
    users.sort((a, b) => {
      const pa = a.profile?.created_at as string | undefined;
      const pb = b.profile?.created_at as string | undefined;
      return String(pb ?? a.created_at ?? '').localeCompare(String(pa ?? b.created_at ?? ''));
    });
    return json({ ok: true, users });
  }

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
  if (action === 'reset-password') {
    const password = String(body?.password ?? '');
    if (password.length < 8) return json({ ok: false, error: 'weak password (min 8 chars)' }, 400);
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(password) || !/\d/.test(password)) {
      return json({ ok: false, error: 'weak password (letter + number)' }, 400);
    }
    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      ban_duration: 'none',
    });
    if (pwErr) return json({ ok: false, error: pwErr.message }, 400);
    const { error: flagErr } = await admin
      .from('profiles')
      .update({ must_change_password: true, is_blocked: false })
      .eq('id', userId);
    if (flagErr) return json({ ok: false, error: flagErr.message }, 400);
    return json({ ok: true });
  }
  return json({ ok: false, error: 'unknown action' }, 400);
});
