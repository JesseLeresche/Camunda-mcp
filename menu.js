/**
 * Camunda Modeler menu plugin — loaded by the Modeler via require().
 * Must export a function directly (not as exports.default).
 * Delegates to the compiled TypeScript module for status tracking.
 */
try {
  const { getMenuLabel } = require('./dist/menu');
  module.exports = function () {
    return [{ label: getMenuLabel(), enabled: false }];
  };
} catch (err) {
  module.exports = function () {
    return [{ label: 'MCP Server: Not built', enabled: false }];
  };
}
