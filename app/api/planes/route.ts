import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle preflight
export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}

export async function GET() {
  try {
    const { data: planes, error } = await supabase
      .from('planes')
      .select('*')
      .order('precio', { ascending: true });

    if (error) {
      console.error('Error fetching planes:', error);
      return Response.json(
        { ok: false, error: 'Error cargando planes' },
        { status: 500, headers }
      );
    }

    // Mapear datos de Supabase al formato que espera el frontend
    const planesFormateados = planes.map((p: any) => ({
      id: p.id,
      nombre: p.nombre.toUpperCase(),
      precio: p.precio,
      descripcion: p.descripcion,
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
        descripcion: '7 días gratis',
        color: '#22c55e',
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
