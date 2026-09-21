import { createClient } from '@supabase/supabase-js';
import { KNOWN_APPS, PLAN_FALLBACK } from '../../../lib/mp-contract';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cliente lazy por request, claves solo desde el entorno
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!
  );
}

// Handle preflight
export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}

export async function GET(request: Request) {
  try {
    const appId = new URL(request.url).searchParams.get('app_id');

    if (!appId || !KNOWN_APPS.includes(appId)) {
      return Response.json(
        { ok: false, error: 'app_id requerido. Use: ordo o canyp' },
        { status: 400, headers }
      );
    }

    const { data: planes, error } = await getSupabase()
      .from('planes_suscripcion')
      .select('*')
      .eq('app_id', appId)
      .eq('activo', true)
      .order('precio', { ascending: true });

    // Fallback al catálogo del contrato si Supabase falla o devuelve vacío
    const fuente = error || !planes || planes.length === 0
      ? PLAN_FALLBACK[appId]
      : planes;

    // Mapear datos de Supabase al formato que espera el frontend
    const planesFormateados = fuente.map((p: any) => ({
      id: p.id,
      nombre: p.nombre.toUpperCase(),
      precio: p.precio,
      descripcion: p.descripcion,
      dias: p.dias,
      color: p.color || '#2e86de',
      precioMensual: p.precio_mensual,
      feature: p.feature || []
    }));

    // Agregar plan de prueba si no existe en BD
    const tienePrueba = planesFormateados.some((p: any) => p.id === 'prueba');
    if (!tienePrueba) {
      planesFormateados.unshift({
        id: 'prueba',
        nombre: 'PRUEBA',
        precio: 0,
        dias: 7,
        descripcion: '7 días gratis',
        color: '#22c55e',
        precioMensual: 0,
        feature: ['Acceso completo al ERP', '7 días de uso', 'Solo 1 vez por dispositivo']
      });
    }

    return Response.json({
      ok: true,
      planes: planesFormateados
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { ok: false, error: 'Error interno del servidor' },
      { status: 500, headers }
    );
  }
}