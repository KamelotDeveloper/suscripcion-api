import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

export async function POST(request: Request) {
  try {
    const { client_id, email } = await request.json();

    if (!client_id || !email) {
      return Response.json(
        { error: 'client_id y email requeridos' }, 
        { status: 400 }
      );
    }

    // Verificar si ya tiene suscripción activa
    const { data: existente } = await supabase
      .from('suscripciones')
      .select('*')
      .eq('client_id', client_id)
      .single();

    if (existente) {
      // Ya existe, verificar estado
      const ahora = new Date();
      const expira = new Date(existente.fecha_expiracion);
      
      if (existente.estado === 'activo' || existente.estado === 'prueba') {
        if (expira > ahora) {
          return Response.json({
            ok: true,
            mensaje: 'Ya tienes suscripción activa',
            estado: existente.estado,
            fecha_expiracion: existente.fecha_expiracion
          });
        }
      }
    }

    // Crear prueba gratis de 7 días
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
      console.error('Error:', error);
      return Response.json(
        { error: 'Error al iniciar prueba' },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      mensaje: 'Prueba gratis de 7 días activada',
      fecha_expiracion: fechaExpiracion.toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500 }
    );
  }
}