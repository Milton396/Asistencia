// Edge Function única que enruta por "action", igual que el switch de
// doGet/doPost en apps-script/Code.gs. Objetivo: que js/api.js necesite
// cambiar lo mínimo posible en la Fase 4 (misma forma de llamar, mismo
// contrato de respuesta { ok, data } / { ok, error }).
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Todas las lecturas/escrituras se hacen con la service role key (nunca
// expuesta al cliente): el control de acceso lo decide esta función, no
// RLS. Ver supabase/README.md, decisión de diseño #2.
function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

// ==================== AUTENTICACIÓN (equivalente a requireAdmin en Code.gs) ====================
// El login en sí ya no pasa por aquí: lo hace supabase-js directo contra
// Supabase Auth (Fase 4). Esta función valida el access_token de esa
// sesión y confirma que la cuenta es administrador, antes de cualquier
// acción protegida. Los mensajes son los mismos que ya usa Code.gs,
// porque js/api.js cierra sesión automáticamente al ver alguno de ellos
// (ver ERRORES_SESION en js/api.js) — no cambiar el texto sin revisar eso.
async function requireAdmin(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('No autorizado. Inicie sesión.');

  const { data: userData, error: userError } = await supabaseAdmin().auth.getUser(token);
  if (userError || !userData?.user) throw new Error('Sesión expirada. Vuelva a iniciar sesión.');

  const { data: perfil, error: perfilError } = await supabaseAdmin()
    .from('perfiles_admin')
    .select('nombre, rol')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (perfilError) throw new Error(perfilError.message);
  if (!perfil || perfil.rol !== 'administrador') {
    throw new Error('Requiere permisos de administrador.');
  }

  return { userId: userData.user.id, email: userData.user.email, nombre: perfil.nombre, rol: perfil.rol };
}

// ==================== ACCIONES PÚBLICAS (sin login) ====================
// Equivalentes a listarEmpleados()/obtenerConfigPublica() en Code.gs.

async function listarEmpleados() {
  const { data, error } = await supabaseAdmin()
    .from('empleados')
    .select('codigo, nombre, cargo, turno, correo')
    .order('nombre');
  if (error) throw new Error(error.message);
  return data.map((e) => ({
    codigo: e.codigo,
    nombre: e.nombre,
    cargo: e.cargo,
    turno: e.turno,
    correo: e.correo || '',
  }));
}

async function obtenerConfigPublica() {
  const { data, error } = await supabaseAdmin()
    .from('config')
    .select('lat, lng, radio_metros, turnos')
    .single();
  if (error) throw new Error(error.message);
  return {
    lat: data.lat,
    lng: data.lng,
    radio: Number(data.radio_metros || 5),
    turnos: data.turnos || [],
  };
}

// ==================== ROUTER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let action: string | null = null;
    let body: Record<string, unknown> = {};

    if (req.method === 'GET') {
      const url = new URL(req.url);
      action = url.searchParams.get('action');
      body = Object.fromEntries(url.searchParams.entries());
    } else if (req.method === 'POST') {
      body = await req.json().catch(() => ({}));
      action = (body.action as string | undefined) ?? null;
    } else {
      throw new Error(`Método no soportado: ${req.method}`);
    }

    let data: unknown;
    switch (action) {
      case 'empleados':
        data = await listarEmpleados();
        break;
      case 'config':
        data = await obtenerConfigPublica();
        break;
      case 'perfil': {
        // Con Supabase Auth, el login ya no devuelve "nombre" (eso vivía
        // en la tabla USUARIOS). El frontend llama a esto justo después
        // de iniciar sesión para mostrar el nombre del administrador.
        const sesion = await requireAdmin(req);
        data = { nombre: sesion.nombre, rol: sesion.rol, email: sesion.email };
        break;
      }
      default:
        throw new Error(`Acción ${req.method} no reconocida: ${action}`);
    }

    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
