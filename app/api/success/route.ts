<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suscripción Activada - GA Software ERP</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 24px;
      padding: 48px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .success-icon {
      width: 80px;
      height: 80px;
      background: #22c55e;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .success-icon svg {
      width: 40px;
      height: 40px;
      stroke: white;
    }
    h1 {
      color: #111827;
      font-size: 28px;
      margin-bottom: 12px;
    }
    .subtitle {
      color: #6b7280;
      font-size: 16px;
      margin-bottom: 32px;
    }
    .plan-info {
      background: #f3f4f6;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
    }
    .plan-name {
      color: #2e86de;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .plan-details {
      color: #6b7280;
      font-size: 14px;
    }
    .btn {
      display: inline-block;
      background: #2e86de;
      color: white;
      padding: 16px 32px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #1a6fc4;
    }
    .close-info {
      margin-top: 24px;
      color: #9ca3af;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
      </svg>
    </div>
    
    <h1>¡Pago Exitoso! 🎉</h1>
    <p class="subtitle">Tu suscripción a GA Software ERP está completamente activada</p>
    
    <div class="plan-info">
      <div class="plan-name">Plan Mensual</div>
      <p class="plan-details">
        Válido hasta: <strong>25 de mayo de 2026</strong>
      </p>
    </div>
    
    <a href="#" class="btn" onclick="window.close()">Cerrar esta ventana</a>
    
    <p class="close-info">
      Ya podés usar tu aplicación ERP con acceso completo
    </p>
  </div>
</body>
</html>