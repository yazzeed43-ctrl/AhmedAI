export const metadata = {
  title: 'أحمد',
  description: 'المساعد الذكي المدير',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, fontFamily: 'Tahoma, Arial, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
