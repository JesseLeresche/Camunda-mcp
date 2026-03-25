/**
 * Camunda Modeler plugin menu entry.
 *
 * Shows the current MCP server status in the Plugins menu.
 * The status is updated by server.ts once the HTTP server starts.
 */

let serverStatus = 'Starting...';
let serverPort: number | null = null;

/**
 * Called by server.ts to update the menu label after the server binds
 * to a port successfully.
 */
export function updateMenuStatus(port: number): void {
  serverStatus = 'Running';
  serverPort = port;
}

/**
 * Returns the current label string for the Plugins menu entry.
 */
export function getMenuLabel(): string {
  if (serverPort) {
    return `MCP Server: ${serverStatus} (port ${serverPort})`;
  }
  return `MCP Server: ${serverStatus}`;
}

/**
 * Camunda Modeler menu plugin format.
 *
 * The Modeler calls this function and expects an array of Electron
 * MenuItem-like objects to insert under the Plugins menu.
 */
export default function (_electronMenu: unknown): Array<{ label: string; enabled: boolean }> {
  return [
    {
      label: getMenuLabel(),
      enabled: false
    }
  ];
}
