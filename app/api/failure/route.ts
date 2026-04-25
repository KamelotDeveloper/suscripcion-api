<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error en el Pago - GA Software ERP</title>
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
    .error-icon {
      width: 80px;
      height: 80px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .error-icon svg {
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
    .btn {
      display: inline-block;
      background: #6b7280;
      color: white;
      padding: 16px 32px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #4b5563;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </div>
    
    <h1>Algo salió mal</h1>
    <p class="subtitle">El pago no se pudo completar. Por favor intentá de nuevo.</p>
    
    <a href="#" class="btn" onclick="window.close()">Cerrar</a>
  </div>
</body>
</html>