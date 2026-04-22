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

export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}

export async function POST(request: Request) {
  try {
    const { client_id, email } = await request.json();

    if (!client_id || !email) {
      return Response.json(
        { error: 'client_id y email requeridos' }, 
        { status: 400, headers }
      );
    }

    const { data: existente } = await supabase
      .from('suscripciones')
      .select('*')
      .eq('client_id', client_id)
      .single();

    if (existente) {
      const ahora = new Date();
      const expira = new Date(existente.fecha_expiracion);
      
      if (existente.estado === 'activo' || existente.estado === 'prueba') {
        if (expira > ahora) {
          return Response.json({
            ok: true,
            mensaje: 'Ya tienes suscripción activa',
            estado: existente.estado,
            fecha_expiracion: existente.fecha_expiracion
          }, { headers });
        }
      }
    }

    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + 7);

    const { error } = await supabase
      .from('suscripciones')
      .upsert({
        client_id: client_id,
        email: email,
        plan: '1_mes',
        estado: 'prueba',
        fecha_inicio: new Date().toISOString(),
        fecha_expiracion: fechaExpiracion.toISOString(),
        mp_payment_id: null
      }, { onConflict: 'client_id' });

    if (error) {
      return Response.json(
        { error: 'Error al iniciar prueba' },
        { status: 500, headers }
      );
    }

    return Response.json({
      ok: true,
      mensaje: 'Prueba gratis de 7 días activada',
      fecha_expiracion: fechaExpiracion.toISOString()
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500, headers }
    );
  }
}