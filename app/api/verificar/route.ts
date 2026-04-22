import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
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
    const { client_id } = await request.json();

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
    const expira = new Date(suscripcion.fecha_expiracion);
    const activo = suscripcion.estado === 'prueba' || 
                   (suscripcion.estado === 'activo' && expira > ahora);

    const diasRestantes = activo 
      ? Math.ceil((expira.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return Response.json({
      activo,
      estado: suscripcion.estado,
      plan: suscripcion.plan,
      fecha_expiracion: suscripcion.fecha_expiracion,
      dias_restantes: diasRestantes,
      mensaje: activo 
        ? `Suscripción activa (${diasRestantes} días)` 
        : 'Suscripción expirada'
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500, headers }
    );
  }
}