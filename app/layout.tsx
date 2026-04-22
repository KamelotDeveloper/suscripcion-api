export const metadata = {
  title: 'API de Suscripción - El Menestral ERP',
  description: 'Sistema de suscripción y pagos',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}