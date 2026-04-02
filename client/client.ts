/**
 * Camunda Modeler MCP Plugin — renderer entry point.
 *
 * Registers the MCP command handler as a bpmn-js additional module so it
 * is instantiated in every BPMN Modeler instance. The module listens for
 * `mcp:command` IPC messages from the main-process MCP server and calls
 * the bpmn-js modeling API to execute them.
 */
import { registerBpmnJSPlugin } from 'camunda-modeler-plugin-helpers';
import McpCommandModule from './bpmn-tools';
import './tab-manager'; // Side-effect: registers client extension for tab management

registerBpmnJSPlugin(McpCommandModule);
