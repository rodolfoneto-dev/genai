const server = require('./server');

describe('GenAI Service - MCP Server Unit Tests', () => {
  it('deve exportar instância válida do McpServer', () => {
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });
});
