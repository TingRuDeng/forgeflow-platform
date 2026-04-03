export function buildDashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>ForgeFlow Console Redirect</title>
  <script>
    window.location.href = 'http://localhost:8788';
  </script>
</head>
<body>
  Redirecting to <a href="http://localhost:8788">ForgeFlow Console</a>...
</body>
</html>`;
}
