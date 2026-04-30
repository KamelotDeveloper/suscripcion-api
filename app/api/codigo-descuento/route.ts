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
    const { codigo, client_id } = await request.json();

    if (!codigo) {
      return Response.json(
        { error: 'Código requerido' }, 
        { status: 400, headers }
      );
    }

    // Buscar código en Supabase (incluye DEVELOPERTEST)
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

    // Verificar expiración
    if (data.fecha_expiracion && new Date(data.fecha_expiracion) < new Date()) {
      return Response.json(
        { valido: false, error: 'Código expirado' },
        { headers }
      );
    }

    // Verificar límite de usos globales
    if (data.usos_actuales >= data.usos_maximos) {
      return Response.json(
        { valido: false, error: 'Código agotado' },
        { headers }
      );
    }

    // Si el código requiere uso único por usuario y hay client_id
    if (data.uso_unico_por_usuario && client_id) {
      // Verificar si este client_id ya usó este código
      const { data: usoExistente } = await supabase
        .from('uso_codigos')
        .select('*')
        .eq('codigo', codigo.toUpperCase())
        .eq('client_id', client_id)
        .single();
      
      if (usoExistente) {
        return Response.json(
          { valido: false, error: 'Ya usaste este código' },
          { headers }
        );
      }
    }

    return Response.json({
      valido: true,
      descuento: data.descuento_porcentaje,
      plan_objetivo: data.plan_objetivo,
      mensaje: `¡Código válido! ${data.descuento_porcentaje}% de descuento`,
      codigo_id: data.id
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500, headers }
    );
  }
}