import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  createModelSchema, createFormSchema, addFormFieldSchema, createDmnSchema, deployProcessSchema,
} from '../registry';
import type { CallToolResult } from '../handlers';
import { executeInRenderer } from './tabs';

const LOG_PREFIX = '[camunda-mcp]';

/**
 * Target Camunda 8 execution platform version stamped onto new diagrams.
 * Override via MCP_EXECUTION_PLATFORM_VERSION if your cluster runs a
 * different version — without this, Modeler silently defaults new diagrams
 * to its own bundled version, which can drift from the connected cluster.
 */
const EXECUTION_PLATFORM_VERSION = process.env.MCP_EXECUTION_PLATFORM_VERSION || '8.6';

/**
 * Minimal valid BPMN 2.0 XML for a new empty diagram.
 */
const EMPTY_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/BPMN/20100524/DC"
                  xmlns:modeler="http://camunda.org/schema/modeler/1.0"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"
                  exporter="Camunda MCP Plugin" exporterVersion="0.1.0"
                  modeler:executionPlatform="Camunda Cloud"
                  modeler:executionPlatformVersion="${EXECUTION_PLATFORM_VERSION}">
  <bpmn:process id="Process_1" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * Creates a new empty BPMN diagram and opens it in the Camunda Desktop Modeler.
 *
 * - Generates a unique diagramId
 * - Writes minimal BPMN XML to a temp file
 * - Opens the file via Electron's shell.openPath()
 */
export async function createModel(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = createModelSchema.parse(params);
  const diagramId = `diagram-${Date.now()}`;
  const name = parsed.name || diagramId;
  const fileName = `${name}.bpmn`;
  const filePath = path.join(os.tmpdir(), path.basename(fileName));

  // Write the BPMN XML to a temp file
  try {
    fs.writeFileSync(filePath, EMPTY_BPMN_XML, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('%s Failed to write BPMN file to %s:', LOG_PREFIX, filePath, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write diagram file: ${message}` }) }],
      isError: true,
    };
  }

  // Open the file via Modeler's own 'open-diagram' action (same primitive
  // switchTab uses) rather than shell.openPath() — shell.openPath() asks the
  // OS to resolve a handler for .bpmn by file association, which on a
  // machine without Modeler set as the default handler surfaces an "Open
  // with…" picker instead of ever reaching Modeler. Going through the tab
  // manager also gives us the real tab id directly, no polling/guessing.
  let realDiagramId = diagramId;
  let resolvedTab = false;
  let warning: string | undefined;
  try {
    const opened = await executeInRenderer(
      `window.__mcpTabManager`
      + ` ? window.__mcpTabManager.openDiagram(${JSON.stringify(filePath)})`
      + ` : Promise.reject(new Error('Tab manager not initialized — ensure the plugin is loaded and at least one diagram has been opened'))`
    );
    if (opened?.id) {
      realDiagramId = opened.id;
      resolvedTab = true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} Failed to open diagram via tab manager: ${message}`);
    warning = `Could not confirm the new tab opened in Modeler (${message}). `
      + 'Use manage_diagram {operation: "list"} to find the real tab id.';
  }

  const result: Record<string, unknown> = { diagramId: realDiagramId, filePath, message: `Created diagram "${name}"` };
  if (!resolvedTab) {
    result.warning = warning ?? 'Could not confirm the new tab registered with the Modeler — '
      + 'diagramId may not resolve. Use manage_diagram {operation: "list"} to find the real tab id.';
  }
  console.log(`${LOG_PREFIX} Created model: ${realDiagramId} at ${filePath} (resolved: ${resolvedTab})`);

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

/**
 * Creates a new Camunda Form (.form) JSON file.
 */
export async function createForm(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = createFormSchema.parse(params);
  const formId = `Form_${parsed.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const fileName = `${parsed.name}.form`;
  const filePath = path.join(os.tmpdir(), path.basename(fileName));

  let fieldCounter = 0;
  const components: any[] = [];

  if (parsed.fields) {
    for (const field of parsed.fields) {
      fieldCounter++;
      const component: any = {
        label: field.label,
        type: field.type,
        id: `Field_${fieldCounter.toString().padStart(3, '0')}`,
        key: field.key,
      };
      if (field.required) {
        component.validate = { required: true };
      }
      if (field.description) {
        component.description = field.description;
      }
      if (field.options && ['select', 'radio', 'taglist'].includes(field.type)) {
        component.values = field.options.map(o => ({ label: o.label, value: o.value }));
      }
      components.push(component);
    }
  }

  const formJson = {
    components,
    type: 'default',
    id: formId,
    executionPlatform: 'Camunda Cloud',
    executionPlatformVersion: '8.4.0',
    exporter: { name: 'Camunda MCP Plugin', version: '0.1.0' },
    schemaVersion: 16,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(formJson, null, 2), 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write form file: ${message}` }) }],
      isError: true,
    };
  }

  console.log(`${LOG_PREFIX} Created form: ${formId} at ${filePath}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({ formId, filePath, fieldCount: components.length }) }],
  };
}

/**
 * Adds a field to an existing Camunda Form (.form) file.
 */
export async function addFormField(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = addFormFieldSchema.parse(params);

  let formJson: any;
  try {
    const raw = fs.readFileSync(parsed.formPath, 'utf-8');
    formJson = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to read form file: ${message}` }) }],
      isError: true,
    };
  }

  if (!formJson.components) {
    formJson.components = [];
  }

  const fieldId = `Field_${(formJson.components.length + 1).toString().padStart(3, '0')}`;
  const component: any = {
    label: parsed.label,
    type: parsed.type,
    id: fieldId,
    key: parsed.key,
  };
  if (parsed.required) {
    component.validate = { required: true };
  }
  if (parsed.description) {
    component.description = parsed.description;
  }
  if (parsed.options && ['select', 'radio', 'taglist'].includes(parsed.type)) {
    component.values = parsed.options.map(o => ({ label: o.label, value: o.value }));
  }

  formJson.components.push(component);

  try {
    fs.writeFileSync(parsed.formPath, JSON.stringify(formJson, null, 2), 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write form file: ${message}` }) }],
      isError: true,
    };
  }

  console.log(`${LOG_PREFIX} Added field ${parsed.key} to form at ${parsed.formPath}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({ fieldId, key: parsed.key, fieldCount: formJson.components.length }) }],
  };
}

/**
 * Creates a new DMN decision table file.
 */
export async function createDmn(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = createDmnSchema.parse(params);
  const fileName = `${parsed.name}.dmn`;
  const filePath = path.join(os.tmpdir(), path.basename(fileName));

  // Build inputs XML
  let inputsXml = '';
  if (parsed.inputs && parsed.inputs.length > 0) {
    inputsXml = parsed.inputs.map((inp, i) => {
      const id = `Input_${i + 1}`;
      const exprId = `InputExpression_${i + 1}`;
      return `      <input id="${id}" label="${escapeXml(inp.label)}">
        <inputExpression id="${exprId}" typeRef="${escapeXml(inp.type)}">
          <text>${escapeXml(inp.expression)}</text>
        </inputExpression>
      </input>`;
    }).join('\n');
  } else {
    inputsXml = `      <input id="Input_1" label="Input">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text></text>
        </inputExpression>
      </input>`;
  }

  // Build outputs XML
  let outputsXml = '';
  if (parsed.outputs && parsed.outputs.length > 0) {
    outputsXml = parsed.outputs.map((out, i) => {
      const id = `Output_${i + 1}`;
      return `      <output id="${id}" label="${escapeXml(out.label)}" name="${escapeXml(out.name)}" typeRef="${escapeXml(out.type)}" />`;
    }).join('\n');
  } else {
    outputsXml = `      <output id="Output_1" label="Output" name="output" typeRef="string" />`;
  }

  const dmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             id="Definitions_1" name="DRD" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="Decision_1" name="${escapeXml(parsed.tableName)}">
    <decisionTable id="DecisionTable_1" hitPolicy="${escapeXml(parsed.hitPolicy)}">
${inputsXml}
${outputsXml}
    </decisionTable>
  </decision>
</definitions>`;

  try {
    fs.writeFileSync(filePath, dmnXml, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('%s Failed to write DMN file to %s:', LOG_PREFIX, filePath, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write DMN file: ${message}` }) }],
      isError: true,
    };
  }

  // Attempt to open the file via Electron's shell
  try {
    const electron = require('electron') as { shell: { openPath: (path: string) => Promise<string> } };
    const { shell } = electron;
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      console.warn(`${LOG_PREFIX} shell.openPath warning: ${errorMessage}`);
    }
  } catch {
    console.warn(`${LOG_PREFIX} Electron not available; skipping shell.openPath`);
  }

  console.log(`${LOG_PREFIX} Created DMN: ${parsed.tableName} at ${filePath}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({
      filePath,
      tableName: parsed.tableName,
      hitPolicy: parsed.hitPolicy,
      inputCount: parsed.inputs?.length ?? 1,
      outputCount: parsed.outputs?.length ?? 1,
    }) }],
  };
}

/**
 * Escapes special XML characters in a string.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Stub handler for deploying a BPMN process to Camunda 8 Zeebe.
 * Returns configuration guidance — actual deployment requires @camunda8/sdk.
 */
export async function deployProcess(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = deployProcessSchema.parse(params);
  const clusterUrl = parsed.clusterUrl || process.env.ZEEBE_ADDRESS;
  const clientId = parsed.clientId || process.env.ZEEBE_CLIENT_ID;

  if (!clusterUrl) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: 'Zeebe cluster not configured',
        message: 'Set ZEEBE_ADDRESS, ZEEBE_CLIENT_ID, and ZEEBE_CLIENT_SECRET environment variables, or pass clusterUrl/clientId/clientSecret parameters. Install @camunda8/sdk for full deployment support.',
        requiredEnvVars: ['ZEEBE_ADDRESS', 'ZEEBE_CLIENT_ID', 'ZEEBE_CLIENT_SECRET'],
      }) }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({
      message: 'Deployment not yet implemented — @camunda8/sdk integration planned for a future release.',
      filePath: parsed.filePath,
      clusterUrl,
    }) }],
  };
}
