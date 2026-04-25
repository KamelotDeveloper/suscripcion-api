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
    const { codigo } = await request.json();

    if (!codigo) {
      return Response.json(
        { error: 'Código requerido' }, 
        { status: 400, headers }
      );
    }

    // Código de prueba hardcodeado para testing
    if (codigo.toUpperCase() === 'DEVELOPERTEST') {
      return Response.json({
        valido: true,
        descuento: 100,
        plan_objetivo: '1_mes',
        mensaje: '¡Código válido! 100% de descuento (prueba developer)'
      }, { headers });
    }

    const { data, error } = await supabase
      .from('codigos_descuento')
      .select('*')
      .eq('codigo', codigo.toUpperCase())
      .single();

    if (error || !data) {
      return Response.json(
        { valido: false, error: 'Código inválido' },
        { headers }
      );
    }

    if (data.fecha_expiracion && new Date(data.fecha_expiracion) < new Date()) {
      return Response.json(
        { valido: false, error: 'Código expirado' },
        { headers }
      );
    }

    if (data.usos_actuales >= data.usos_maximos) {
      return Response.json(
        { valido: false, error: 'Código agotado' },
        { headers }
      );
    }

    return Response.json({
      valido: true,
      descuento: data.descuento_porcentaje,
      plan_objetivo: data.plan_objetivo,
      mensaje: `¡Código válido! ${data.descuento_porcentaje}% de descuento`
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500, headers }
    );
  }
}