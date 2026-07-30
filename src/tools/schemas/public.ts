import { z } from 'zod';
import {
  buildProcessSchema, batchOperationsSchema, createDmnSchema, deployProcessSchema,
  kbSearchSchema,
} from './primitives';

// ===========================================================================
// Consolidated (public) tool schemas
// ---------------------------------------------------------------------------
// The plugin publishes a small set of resource-oriented tools, each selecting
// behaviour via an `operation` enum. These flat schemas describe the full
// published surface; strict per-operation validation is performed in the
// handler against the individual schemas defined above. Fields are optional
// here because their applicability depends on `operation` — the handler
// enforces the real requirements.
// ===========================================================================

export const manageDiagramSchema = z.object({
  operation: z.enum(['create', 'list', 'switch', 'save', 'export_image', 'import_xml', 'get_xml', 'set_execution_platform_version'])
    .describe('Diagram-level action to perform'),
  diagramId: z.string().optional().describe('Target diagram ID (returned by create). Required for save/export_image/import_xml/get_xml/set_execution_platform_version; optional for switch.'),
  name: z.string().optional().describe('create: diagram name. switch: diagram name (partial, case-insensitive).'),
  filePath: z.string().optional().describe('save/export_image: absolute output path. switch: .bpmn file path to match.'),
  format: z.enum(['svg', 'png']).optional().describe('export_image: image format (default png)'),
  scale: z.number().optional().describe('export_image: PNG scale factor (default 2)'),
  xml: z.string().optional().describe('import_xml: complete BPMN 2.0 XML to import'),
  version: z.string().optional().describe('set_execution_platform_version: target version, e.g. "8.10", matching your connected Zeebe cluster.'),
  platform: z.string().optional().describe('set_execution_platform_version: execution platform name (default "Camunda Cloud").'),
});

export const addElementSchema = z.object({
  operation: z.enum(['start', 'end', 'task', 'gateway', 'event', 'subprocess', 'pool', 'lane', 'annotation', 'group'])
    .describe('Kind of element to add'),
  diagramId: z.string().describe('ID returned by manage_diagram create'),
  type: z.string().optional().describe('Specific BPMN type for task/gateway/event/subprocess (e.g. "bpmn:ServiceTask", "bpmn:ParallelGateway", "bpmn:SubProcess"). Defaults applied per kind.'),
  name: z.string().optional().describe('Element label'),
  x: z.number().optional().describe('Canvas x coordinate'),
  y: z.number().optional().describe('Canvas y coordinate'),
  parentId: z.string().optional().describe('Parent expanded subprocess ID (nest the element inside it)'),
  // start / end / event
  eventDefinitionType: z.string().optional().describe('Event/start/end definition (Timer, Message, Signal, Error, Escalation, Conditional, Compensate, Terminate). end/start: presence (≠ none) creates a typed start/end event — a process may only have one blank start event, so use a typed one (e.g. Message) for a second distinct trigger. start supports Message/Signal/Timer only.'),
  attachedToId: z.string().optional().describe('event: host element ID (required for boundary events)'),
  cancelActivity: z.boolean().optional().describe('event boundary: interrupting (true) vs non-interrupting (false)'),
  boundaryPosition: z.enum(['bottom', 'bottom-left', 'bottom-right', 'top', 'top-left', 'top-right', 'left', 'right']).optional().describe('event boundary: placement on host edge'),
  timerValue: z.string().optional().describe('event: ISO 8601 timer expression (e.g. PT1H)'),
  timerType: z.enum(['timeDuration', 'timeCycle', 'timeDate']).optional().describe('event: timer type'),
  errorRef: z.string().optional().describe('end/event (ErrorEventDefinition): error name. Find-or-creates a bpmn:Error root element (required by Camunda validation).'),
  errorCode: z.string().optional().describe('errorCode when find-or-creating the bpmn:Error referenced by errorRef. Camunda requires a non-empty errorCode on any error reference; defaults to the errorRef name if omitted.'),
  messageRef: z.string().optional().describe('start/end/event (MessageEventDefinition), or task (ReceiveTask required, SendTask optional): message name. Find-or-creates a bpmn:Message root element.'),
  correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for task (ReceiveTask) or event (BoundaryEvent/IntermediateCatchEvent with MessageEventDefinition) — required by Camunda validation alongside messageRef. Not applicable to start, SendTask, or IntermediateThrowEvent.'),
  signalRef: z.string().optional().describe('start/end/event (SignalEventDefinition): signal name. Find-or-creates a bpmn:Signal root element.'),
  escalationRef: z.string().optional().describe('end/event (EscalationEventDefinition): escalation name. Find-or-creates a bpmn:Escalation root element.'),
  escalationCode: z.string().optional().describe('escalationCode when find-or-creating the bpmn:Escalation referenced by escalationRef. Defaults to the escalationRef name if omitted.'),
  // task
  taskType: z.string().optional().describe('task: Zeebe job type. Required by Camunda validation for ServiceTask, SendTask, BusinessRuleTask, and ScriptTask — not just ServiceTask.'),
  taskRetries: z.string().optional().describe('task: Zeebe retry count for taskType (default "3").'),
  // subprocess / pool / group
  width: z.number().optional().describe('subprocess/pool/group: width'),
  height: z.number().optional().describe('subprocess/pool/group: height'),
  collapsed: z.boolean().optional().describe('subprocess: collapsed'),
  calledElement: z.string().optional().describe('subprocess: process ID to call (CallActivity)'),
  categoryValue: z.string().optional().describe('group: BPMN category value'),
  // lane
  participantId: z.string().optional().describe('lane: ID of the pool to add the lane to'),
  // annotation
  text: z.string().optional().describe('annotation: text content'),
  attachToId: z.string().optional().describe('annotation: element ID to associate with'),
});

export const connectSchema = z.object({
  operation: z.enum(['sequence_flow', 'message_flow', 'set_waypoints'])
    .describe('Connection action: create a sequence flow, create a cross-pool message flow, or replace waypoints on an existing flow'),
  diagramId: z.string().describe('ID returned by manage_diagram create'),
  sourceId: z.string().optional().describe('sequence_flow/message_flow: source element ID'),
  targetId: z.string().optional().describe('sequence_flow/message_flow: target element ID'),
  name: z.string().optional().describe('message_flow: label'),
  flowId: z.string().optional().describe('set_waypoints: ID of the existing flow to re-route'),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional()
    .describe('sequence_flow: optional routing path. set_waypoints: new path including source/target points (min 2).'),
  conditionExpression: z.string().optional().describe('sequence_flow: FEEL/JUEL condition. Required (or isDefault) for every non-default flow out of a gateway/activity with multiple outgoing flows.'),
  isDefault: z.boolean().optional().describe('sequence_flow: mark as the default flow of its source element. Only one outgoing flow per source can be default.'),
});

export const updateElementSchema = z.object({
  operation: z.enum(['properties', 'move', 'resize', 'io_mapping', 'headers'])
    .describe('What to update. properties = name/documentation/condition/implementation in one call.'),
  diagramId: z.string().describe('ID returned by manage_diagram create'),
  elementId: z.string().describe('ID of the element to update'),
  // properties
  name: z.string().optional().describe('properties: element name'),
  documentation: z.string().optional().describe('properties: documentation text'),
  conditionExpression: z.string().optional().describe('properties: FEEL/JUEL condition for sequence flows'),
  implementationType: z.enum(['class', 'delegateExpression', 'expression', 'external', 'connector']).optional().describe('properties: Camunda 7 implementation type'),
  implementationValue: z.string().optional().describe('properties: class/expression/connector value'),
  taskTopic: z.string().optional().describe('properties: external task topic (Camunda 7)'),
  taskPriority: z.string().optional().describe('properties: task priority'),
  taskType: z.string().optional().describe('properties: Zeebe job type (Camunda 8)'),
  taskRetries: z.string().optional().describe('properties: Zeebe retry count'),
  correlationKey: z.string().optional().describe('properties: FEEL expression (e.g. "=orderId") for a ReceiveTask or message catch event — required by Camunda validation alongside a message reference'),
  isExecutable: z.boolean().optional().describe('properties: process isExecutable flag'),
  // move
  x: z.number().optional().describe('move: new center x'),
  y: z.number().optional().describe('move: new center y'),
  // resize
  width: z.number().optional().describe('resize: new width'),
  height: z.number().optional().describe('resize: new height'),
  // io_mapping
  inputs: z.array(z.object({ source: z.string(), target: z.string() })).optional().describe('io_mapping: input variable mappings'),
  outputs: z.array(z.object({ source: z.string(), target: z.string() })).optional().describe('io_mapping: output variable mappings'),
  // headers
  headers: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe('headers: key-value task headers'),
});

export const queryDiagramSchema = z.object({
  operation: z.enum(['list', 'get', 'bounds', 'validate'])
    .describe('list = all elements; get = one element detail; bounds = exact rendered geometry of one element; validate = live Camunda validation errors/warnings for the whole diagram (same data as Modeler\'s Problems panel).'),
  diagramId: z.string().describe('ID returned by manage_diagram create'),
  elementId: z.string().optional().describe('get/bounds: element ID'),
  typeFilter: z.string().optional().describe('list: filter by BPMN type prefix, e.g. "bpmn:Task"'),
  parentId: z.string().optional().describe('list: filter to elements inside this expanded subprocess'),
  fields: z.array(z.string()).optional().describe('list: fields to include per element (id always included)'),
  severity: z.enum(['error', 'warn', 'all']).optional().describe('validate: minimum/exact severity to include (default "all")'),
});

/**
 * Zod schema for the validate_diagram tool.
 * Reads Camunda Modeler's own live linting service directly — the exact
 * same data backing the Problems panel — instead of reimplementing
 * Camunda's validation rules ourselves.
 */
export const validateDiagramSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  severity: z.enum(['error', 'warn', 'all']).default('all').describe('Minimum/exact severity to include.'),
});

export const manageElementSchema = z.object({
  operation: z.enum(['delete', 'clone']).describe('delete an element, or clone one with its configuration'),
  diagramId: z.string().describe('ID returned by manage_diagram create'),
  elementId: z.string().optional().describe('delete: ID of the element to remove'),
  sourceId: z.string().optional().describe('clone: ID of the element to clone'),
  name: z.string().optional().describe('clone: override name on the clone'),
  x: z.number().optional().describe('clone: x position for the clone'),
  y: z.number().optional().describe('clone: y position for the clone'),
  deep: z.boolean().optional().describe('clone: also clone subprocess children and internal flows'),
});

export const layoutSchema = z.object({
  operation: z.enum(['auto', 'validate']).describe('auto = apply smart branch-aware auto-layout; validate = detect layout issues'),
  diagramId: z.string().describe('ID returned by manage_diagram create'),
  elementId: z.string().optional().describe('Scope to a specific expanded subprocess (default: whole diagram)'),
  options: z.object({
    branchSpacing: z.number().optional(),
    horizontalSpacing: z.number().optional(),
    flowRouting: z.enum(['orthogonal', 'direct']).optional(),
    mergeAlignment: z.enum(['center', 'top-branch']).optional(),
    boundaryEventPosition: z.enum(['bottom', 'bottom-right']).optional(),
  }).optional().describe('auto: layout tuning options'),
  autoFix: z.boolean().optional().describe('validate: apply generated fixes automatically'),
  severity: z.enum(['error', 'warning', 'suggestion']).optional().describe('validate: minimum severity to return'),
});

export const manageFormSchema = z.object({
  operation: z.enum(['create', 'add_field', 'link_to_task'])
    .describe('create a .form file, add a field to one, or link a form to a UserTask'),
  // create
  name: z.string().optional().describe('create: form name (filename and form ID)'),
  fields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    type: z.enum(['textfield', 'textarea', 'number', 'checkbox', 'select', 'radio', 'taglist', 'datetime']).optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  })).optional().describe('create: initial fields'),
  // add_field
  formPath: z.string().optional().describe('add_field/link_to_task: path to the .form file'),
  key: z.string().optional().describe('add_field: field variable key'),
  label: z.string().optional().describe('add_field: display label'),
  type: z.enum(['textfield', 'textarea', 'number', 'checkbox', 'select', 'radio', 'taglist', 'datetime']).optional().describe('add_field: field type'),
  required: z.boolean().optional().describe('add_field: whether the field is required'),
  description: z.string().optional().describe('add_field: help text'),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional().describe('add_field: options for select/radio/taglist'),
  // link_to_task
  diagramId: z.string().optional().describe('link_to_task: diagram ID'),
  taskId: z.string().optional().describe('link_to_task: UserTask element ID'),
});

/**
 * Describes a single MCP tool exposed by the plugin.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** true = runs in Node.js main process, false = dispatched via IPC to the renderer */
  executeLocal: boolean;
}

/**
 * Registry of all MCP tools published by this plugin.
 *
 * The public surface is a small set of resource-oriented tools, each selecting
 * behaviour via an `operation` enum (see the consolidated schemas above). The
 * handler translates `(tool, operation)` to the original internal tool name and
 * runs the existing dispatch + renderer implementations unchanged.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'manage_diagram',
    description:
      'Diagram lifecycle and I/O. operation: create (new empty BPMN tab), list (open tabs), switch (active tab by id/path/name), save (write .bpmn to filePath), export_image (PNG/SVG), import_xml (replace from XML), get_xml (export XML), set_execution_platform_version (correct the target Camunda 8 version on the open diagram, e.g. to match your Zeebe cluster).',
    inputSchema: manageDiagramSchema,
    executeLocal: false,
  },
  {
    name: 'build_process',
    description:
      'Declarative process builder — creates all elements and flows in one call. Accepts user-friendly type names (serviceTask, exclusiveGateway, etc). Returns idMap mapping logical IDs to actual bpmn-js IDs. Set autoLayout=true to auto-position. Preferred over many add_element calls.',
    inputSchema: buildProcessSchema,
    executeLocal: false,
  },
  {
    name: 'add_element',
    description:
      'Adds a single BPMN element. operation selects the kind: start, end, task, gateway, event, subprocess, pool, lane, annotation, group. Use the `type` field for the specific BPMN type and `parentId` to nest inside an expanded subprocess.',
    inputSchema: addElementSchema,
    executeLocal: false,
  },
  {
    name: 'connect',
    description:
      'Creates or re-routes connections. operation: sequence_flow (connect two elements), message_flow (cross-pool), set_waypoints (replace routing of an existing flow without touching source/target/labels).',
    inputSchema: connectSchema,
    executeLocal: false,
  },
  {
    name: 'update_element',
    description:
      'Updates an existing element. operation: properties (name/documentation/condition/implementation in one call), move (reposition), resize (width/height), io_mapping (input/output variables), headers (task headers).',
    inputSchema: updateElementSchema,
    executeLocal: false,
  },
  {
    name: 'query_diagram',
    description:
      'Reads diagram state. operation: list (all elements, optional typeFilter/fields), get (full detail incl. properties, extensions, connections), bounds (exact rendered geometry, edge connection points, waypoints), validate (live Camunda validation errors/warnings — the same data as Modeler\'s Problems panel; call this after build_process/batch_operations to confirm the diagram is actually valid instead of assuming so).',
    inputSchema: queryDiagramSchema,
    executeLocal: false,
  },
  {
    name: 'manage_element',
    description:
      'operation: delete (remove an element), clone (duplicate with config; deep=true also clones subprocess children and internal flows).',
    inputSchema: manageElementSchema,
    executeLocal: false,
  },
  {
    name: 'layout',
    description:
      'operation: auto (smart branch-aware auto-layout — fans gateway branches, aligns merges, routes orthogonally, positions boundary events), validate (detect overlaps/diagonal flows/misalignment and optionally autoFix).',
    inputSchema: layoutSchema,
    executeLocal: false,
  },
  {
    name: 'batch_operations',
    description:
      'Executes multiple primitive operations in one undoable call. Each entry is { tool, params } where `tool` is an internal primitive (e.g. "move_element", "connect_elements", "set_properties", "add_task"). Use "$ref:N" in params to reference the elementId/connectionId from operation N. Note: batch uses internal primitive names, not the consolidated public tool names.',
    inputSchema: batchOperationsSchema,
    executeLocal: false,
  },
  {
    name: 'manage_form',
    description:
      'Camunda Form management. operation: create (new .form file with optional fields), add_field (append a field to a .form file), link_to_task (embed/reference a form on a UserTask, auto-detecting Camunda 7 vs 8).',
    inputSchema: manageFormSchema,
    executeLocal: false,
  },
  {
    name: 'create_dmn',
    description: 'Creates a new DMN decision table file.',
    inputSchema: createDmnSchema,
    executeLocal: true,
  },
  {
    name: 'deploy_process',
    description: 'Deploys a BPMN process to a Camunda 8 Zeebe cluster. Requires ZEEBE_ADDRESS, ZEEBE_CLIENT_ID, ZEEBE_CLIENT_SECRET env vars.',
    inputSchema: deployProcessSchema,
    executeLocal: true,
  },
  {
    name: 'kb_search',
    description:
      'Keyword search over the team knowledge base built from docs/knowledge-base/. Each file dropped '
      + 'there (.md, .pdf, .bpmn/.xml, .png/.jpg) is ingested whole as one "document" — its whole text is '
      + 'extracted (Markdown as-is, PDF text layer, BPMN/XML element names + documentation, OCR for images) '
      + 'and indexed in a SQLite FTS5 full-text index; that set of indexed documents is the "corpus" this '
      + 'tool searches. Ranks matches with BM25 (weighs by query-term frequency in the document, offset by '
      + 'how common that term is across the whole corpus, normalized for document length), not semantic/'
      + 'embedding similarity — so it finds documents containing your query words, not just related in '
      + 'meaning. Returns, per result, the source file, format, and a highlighted snippet around the match '
      + '(not the full document) so the agent gets a citable excerpt without a separate fetch.',
    inputSchema: kbSearchSchema,
    executeLocal: true,
  },
];
