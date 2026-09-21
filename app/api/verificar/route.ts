import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle preflight
export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}

export async function POST(request: Request) {
  try {
    const { client_id, app_id = 'ordo' } = await request.json();

    if (!client_id) {
      return Response.json(
        { error: 'client_id requerido' }, 
        { status: 400, headers }
      );
    }

    const { data: suscripcion, error } = await supabase
      .from('suscripciones')
      .select('*')
      .eq('client_id', client_id)
      .eq('app_id', app_id)
      .single();

    if (error || !suscripcion) {
      return Response.json({ 
        activo: false, 
        estado: 'nuevo',
        mensaje: 'Usuario sin suscripción',
        dias_prueba: 7
      }, { headers });
    }

    const ahora = new Date();
    const expira = suscripcion.fecha_expiracion ? new Date(suscripcion.fecha_expiracion) : null;
    const vigente = expira ? expira > ahora : false;
    // 'prueba' es equivalente activo (D5); 'pendiente' NO es activo (G2):
    // el pago aún no fue aprobado por el webhook.
    const activo = suscripcion.estado === 'prueba' ||
                   (suscripcion.estado === 'activo' && vigente);

    const diasRestantes = activo
      ? Math.ceil(((expira as Date).getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    let mensaje = activo
      ? `Suscripción activa (${diasRestantes} días)`
      : 'Suscripción expirada';
    if (suscripcion.estado === 'pendiente') {
      mensaje = 'Pago pendiente de aprobación';
    }

    return Response.json({
      activo,
      estado: suscripcion.estado,
      plan: suscripcion.plan,
      fecha_expiracion: suscripcion.fecha_expiracion,
      dias_restantes: diasRestantes,
      mensaje
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500, headers }
    );
  }
}