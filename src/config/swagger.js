const openApiSpec = require('./openapi');

const generateMarkdownDocs = (spec) => {
  let md = `# ${spec.info.title} (v${spec.info.version})\n\n`;
  md += `${spec.info.description}\n\n`;
  md += `**Base URL:** \`${spec.servers[0]?.url || 'http://localhost:4004'}\`  \n`;
  md += `**Autenticação:** Header \`Authorization: Bearer <token_jwt>\`\n\n`;
  md += `---\n\n`;
  md += `## Endpoints da API\n\n`;

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, details] of Object.entries(methods)) {
      const verb = method.toUpperCase();
      md += `### \`${verb} ${path}\` - ${details.summary || ''}\n\n`;
      if (details.description) {
        md += `${details.description}\n\n`;
      }

      if (details.security && details.security.length > 0) {
        md += `🔒 **Requer Autenticação:** Sim (Bearer JWT)\n\n`;
      } else {
        md += `🔓 **Requer Autenticação:** Não (Público)\n\n`;
      }

      if (details.requestBody) {
        const jsonContent = details.requestBody.content?.['application/json'];
        if (jsonContent?.example) {
          md += `**Exemplo de Request Body (JSON):**\n\n\`\`\`json\n${JSON.stringify(jsonContent.example, null, 2)}\n\`\`\`\n\n`;
        }
      }

      if (details.responses) {
        md += `**Respostas:**\n\n`;
        for (const [status, resp] of Object.entries(details.responses)) {
          md += `- **HTTP ${status}:** ${resp.description || ''}\n`;
        }
        md += `\n`;
      }
      md += `---\n\n`;
    }
  }

  return md;
};

const renderMarkdownViewerHtml = (markdownContent) => {
  const escapedMarkdown = JSON.stringify(markdownContent);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>GenAI Service - API Docs</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
    .container { max-width: 860px; width: 100%; }
    .header-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #30363d; flex-wrap: wrap; gap: 12px; }
    .nav-links { display: flex; gap: 10px; }
    .btn { background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; text-decoration: none; font-size: 14px; }
    .btn:hover { background: #2ea043; }
    .btn-secondary { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; }
    .btn-secondary:hover { background: #30363d; }
    pre { background: #161b22; padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid #30363d; }
    code { font-family: monospace; color: #7ee787; }
    h1, h2, h3 { color: #58a6ff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-actions">
      <div class="nav-links">
        <a href="/docs" class="btn btn-secondary">⚡ Swagger Interativo</a>
        <a href="/docs.json" class="btn btn-secondary" target="_blank">📋 JSON Spec</a>
        <a href="/docs.md" class="btn btn-secondary" target="_blank">📝 Raw .MD</a>
      </div>
    </div>
    <div id="content"></div>
  </div>
  <script>
    document.getElementById('content').innerHTML = marked.parse(${escapedMarkdown});
  </script>
</body>
</html>`;
};

const renderSwaggerUiHtml = () => {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>GenAI Service - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: window.location.pathname.replace(/\\/docs\\/?$/, '/docs.json'),
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    };
  </script>
</body>
</html>`;
};

const swaggerMarkdown = generateMarkdownDocs(openApiSpec);
const swaggerMarkdownHtml = renderMarkdownViewerHtml(swaggerMarkdown);
const swaggerUiHtml = renderSwaggerUiHtml();

module.exports = {
  openApiSpec,
  swaggerMarkdown,
  swaggerMarkdownHtml,
  swaggerUiHtml,
};
