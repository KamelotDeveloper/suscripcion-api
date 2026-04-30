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

    // VERIFICACIÓN CLAVE: ¿Este client_id ya usó la prueba alguna vez?
    // Aunque desinstale y reinstale, no puede usar la prueba de nuevo
    const { data: pruebaExistente } = await supabase
      .from('usuarios_prueba')
      .select('*')
      .eq('client_id', client_id)
      .single();

    if (pruebaExistente) {
      return Response.json({
        ok: false,
        mensaje: 'Ya usaste tu prueba gratis. Adquirí un plan para continuar.',
        error: 'prueba_agotada'
      }, { headers });
    }

    // Verificar si tiene suscripción activa
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

    // Calcular fecha de expiración (7 días)
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + 7);

    // Iniciar prueba
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

    // REGISTRAR que este client_id usó la prueba (para siempre)
    await supabase
      .from('usuarios_prueba')
      .insert({
        client_id: client_id,
        fecha_uso: new Date().toISOString()
      });

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