export default function Home() {
  return (
    <div style={{ 
      fontFamily: 'system-ui, sans-serif', 
      padding: '2rem', 
      maxWidth: '600px', 
      margin: '0 auto' 
    }}>
      <h1>API de Suscripción</h1>
      <p>El Menestral ERP - Sistema de Suscripción</p>
      
      <h2>Endpoints disponibles:</h2>
      <ul>
        <li><code>POST /api/verificar</code> - Verificar suscripción</li>
        <li><code>POST /api/iniciar-prueba</code> - Iniciar prueba gratis</li>
        <li><code>POST /api/codigo-descuento</code> - Validar código</li>
        <li><code>POST /api/webhook</code> - Webhook de MercadoPago</li>
      </ul>
    </div>
  )
}