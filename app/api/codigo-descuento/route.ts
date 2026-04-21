import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

export async function POST(request: Request) {
  try {
    const { codigo } = await request.json();

    if (!codigo) {
      return Response.json(
        { error: 'Código requerido' }, 
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('codigos_descuento')
      .select('*')
      .eq('codigo', codigo.toUpperCase())
      .single();

    if (error || !data) {
      return Response.json(
        { valido: false, error: 'Código inválido' }
      );
    }

    // Verificar expiración
    if (data.fecha_expiracion && new Date(data.fecha_expiracion) < new Date()) {
      return Response.json(
        { valido: false, error: 'Código expirado' }
      );
    }

    // Verificar usos
    if (data.usos_actuales >= data.usos_maximos) {
      return Response.json(
        { valido: false, error: 'Código agotado' }
      );
    }

    return Response.json({
      valido: true,
      descuento: data.descuento_porcentaje,
      plan_objetivo: data.plan_objetivo,
      mensaje: `¡Código válido! ${data.descuento_porcentaje}% de descuento`
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { error: 'Error interno del servidor' }, 
      { status: 500 }
    );
  }
}