/**
 * Camunda Modeler MCP Plugin — entry point
 *
 * This file is loaded by the Camunda Desktop Modeler plugin system.
 * It must be plain JS (not TypeScript) because the Modeler requires it
 * directly without any build step.
 *
 * The `script` and `menu` properties must be file path strings — the
 * Modeler resolves them relative to this plugin directory.
 */

module.exports = {
  name: 'Camunda Modeler MCP Plugin',
  script: './client/dist/client.js',
  menu: './menu.js'
};

// Start the MCP HTTP server when the plugin loads
try {
  const { startMcpServer } = require('./dist/server');
  startMcpServer();
} catch (err) {
  console.warn('[camunda-mcp] Could not start MCP server — dist/ may not be built yet:', err.message);
}
