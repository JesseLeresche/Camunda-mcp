import { z } from 'zod';

/**
 * Zod schema for the kb_search tool.
 * Full-text keyword search over the knowledge base's ingested doc corpus.
 */
export const kbSearchSchema = z.object({
  query: z.string().describe(
    'Search text — SQLite FTS5 query syntax: plain words match any/all terms, '
    + '"quoted phrase" for an exact phrase, prefix* for prefix matching, AND/OR/NOT for boolean logic.'
  ),
  limit: z.number().int().positive().max(20).optional().default(5).describe('Max results to return (default 5)'),
});

/**
 * Zod schema for the create_model tool.
 * Creates a new empty BPMN diagram tab in the Camunda Desktop Modeler.
 */
export const createModelSchema = z.object({
  name: z.string().optional().describe('Optional diagram name'),
});

/**
 * Zod schema for the add_start_event tool.
 * Places a BPMN Start Event on the canvas of an open diagram.
 */
export const addStartEventSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  name: z.string().default('Start').describe('Label for the Start Event'),
  x: z.number().default(200).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools.'),
  eventDefinitionType: z.enum([
    'bpmn:MessageEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:TimerEventDefinition', 'none',
  ]).default('none').describe('Start event definition type. A process may only have one blank (none) start event — use a typed start event (e.g. Message) to model a second, distinct trigger.'),
  messageRef: z.string().optional().describe('For eventDefinitionType bpmn:MessageEventDefinition: message name. Find-or-creates a bpmn:Message root element.'),
  signalRef: z.string().optional().describe('For eventDefinitionType bpmn:SignalEventDefinition: signal name. Find-or-creates a bpmn:Signal root element.'),
  timerValue: z.string().optional().describe('For eventDefinitionType bpmn:TimerEventDefinition: ISO 8601 timer expression (e.g. PT1H, R/PT5M).'),
  timerType: z.enum(['timeDuration', 'timeCycle', 'timeDate']).optional().describe('Timer type when eventDefinitionType is bpmn:TimerEventDefinition.'),
});

/**
 * Zod schema for the add_task tool.
 */
export const addTaskSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  type: z.enum(['bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:Task', 'bpmn:SendTask', 'bpmn:ReceiveTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask', 'bpmn:ManualTask'])
    .default('bpmn:Task').describe('BPMN task type'),
  name: z.string().default('').describe('Label for the task'),
  x: z.number().default(400).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools.'),
  messageRef: z.string().optional().describe('Message name for ReceiveTask (required by Camunda validation) or SendTask (optional). Find-or-creates a bpmn:Message root element with this name.'),
  correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for ReceiveTask only — required by Camunda validation alongside messageRef so Zeebe can correlate the incoming message to a running process instance.'),
  taskType: z.string().optional().describe('Zeebe job type. Required by Camunda validation for ServiceTask, SendTask, BusinessRuleTask, and ScriptTask — not just ServiceTask. Settable here at creation instead of a follow-up set_properties/patch_element call.'),
  taskRetries: z.string().optional().describe('Zeebe retry count for taskType (default "3").'),
});

/**
 * Zod schema for the add_end_event tool.
 */
export const addEndEventSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  name: z.string().default('').describe('Label for the End Event'),
  x: z.number().default(600).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools.'),
});

/**
 * Zod schema for the connect_elements tool.
 */
export const connectElementsSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  sourceId: z.string().describe('ID of the source element'),
  targetId: z.string().describe('ID of the target element'),
  waypoints: z.array(z.object({
    x: z.number().describe('X coordinate of the bendpoint'),
    y: z.number().describe('Y coordinate of the bendpoint'),
  })).optional().describe('Optional array of {x, y} coordinates defining the connection routing path. Include source and target connection points for full control, or just intermediate bendpoints for L-shaped/orthogonal routing.'),
  conditionExpression: z.string().optional().describe('FEEL/JUEL condition for this sequence flow. Every non-default flow out of a gateway (or an activity with multiple outgoing flows) must have either this or isDefault set, or Camunda validation fails.'),
  isDefault: z.boolean().optional().describe('Mark this flow as the default flow of its source element (gateway/activity). Satisfies the "condition or default" validation rule without a conditionExpression. Only one outgoing flow per source can be default.'),
});

/**
 * Zod schema for the create_form tool.
 */
export const createFormSchema = z.object({
  name: z.string().describe('Name for the form (used as filename and form ID)'),
  fields: z.array(z.object({
    key: z.string().describe('Variable key for the field'),
    label: z.string().describe('Display label'),
    type: z.enum(['textfield', 'textarea', 'number', 'checkbox', 'select', 'radio', 'taglist', 'datetime'])
      .default('textfield').describe('Field type'),
    required: z.boolean().default(false).describe('Whether the field is required'),
    description: z.string().optional().describe('Help text shown below the field'),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
    })).optional().describe('Options for select/radio/taglist fields'),
  })).optional().describe('Initial fields to add to the form'),
});

/**
 * Zod schema for the add_form_field tool.
 */
export const addFormFieldSchema = z.object({
  formPath: z.string().describe('Path to the .form file'),
  key: z.string().describe('Variable key for the field'),
  label: z.string().describe('Display label'),
  type: z.enum(['textfield', 'textarea', 'number', 'checkbox', 'select', 'radio', 'taglist', 'datetime'])
    .default('textfield').describe('Field type'),
  required: z.boolean().default(false).describe('Whether the field is required'),
  description: z.string().optional().describe('Help text shown below the field'),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional().describe('Options for select/radio/taglist fields'),
});

/**
 * Zod schema for the link_form_to_task tool.
 */
export const linkFormToTaskSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  taskId: z.string().describe('ID of the UserTask element to link the form to'),
  formPath: z.string().describe('Absolute path to the .form file'),
});

// ---------------------------------------------------------------------------
// v0.2 schemas
// ---------------------------------------------------------------------------

export const addGatewaySchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  type: z.enum(['bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:InclusiveGateway', 'bpmn:EventBasedGateway'])
    .default('bpmn:ExclusiveGateway').describe('Gateway type'),
  name: z.string().default('').describe('Label for the gateway'),
  x: z.number().default(400).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools.'),
});

export const addEventSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  type: z.enum(['bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent'])
    .describe('Event element type'),
  eventDefinitionType: z.enum([
    'bpmn:TimerEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:SignalEventDefinition',
    'bpmn:ErrorEventDefinition', 'bpmn:EscalationEventDefinition',
    'bpmn:ConditionalEventDefinition', 'bpmn:CompensateEventDefinition', 'none',
  ]).default('none').describe('Event definition type'),
  name: z.string().default('').describe('Label for the event'),
  x: z.number().default(400).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  attachedToId: z.string().optional().describe('Host element ID (required for BoundaryEvent)'),
  cancelActivity: z.boolean().default(true).describe('For BoundaryEvent: interrupting (true) or non-interrupting (false)'),
  boundaryPosition: z.enum(['bottom', 'bottom-left', 'bottom-right', 'top', 'top-left', 'top-right', 'left', 'right']).default('bottom').describe('Where to place the boundary event on the host element edge'),
  errorRef: z.string().optional().describe('For eventDefinitionType bpmn:ErrorEventDefinition: error name. Find-or-creates a bpmn:Error root element (required by Camunda validation).'),
  errorCode: z.string().optional().describe('errorCode when find-or-creating the bpmn:Error referenced by errorRef. Camunda requires a non-empty errorCode on any error reference; defaults to the errorRef name if omitted.'),
  messageRef: z.string().optional().describe('For eventDefinitionType bpmn:MessageEventDefinition: message name. Find-or-creates a bpmn:Message root element.'),
  correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for type IntermediateCatchEvent or BoundaryEvent with eventDefinitionType bpmn:MessageEventDefinition — required by Camunda validation alongside messageRef so Zeebe can correlate the incoming message. Not applicable to IntermediateThrowEvent.'),
  signalRef: z.string().optional().describe('For eventDefinitionType bpmn:SignalEventDefinition: signal name. Find-or-creates a bpmn:Signal root element.'),
  escalationRef: z.string().optional().describe('For eventDefinitionType bpmn:EscalationEventDefinition: escalation name. Find-or-creates a bpmn:Escalation root element.'),
  escalationCode: z.string().optional().describe('escalationCode when find-or-creating the bpmn:Escalation referenced by escalationRef. Defaults to the escalationRef name if omitted.'),
  timerValue: z.string().optional().describe('ISO 8601 timer expression (e.g. PT1H, R/PT5M)'),
  timerType: z.enum(['timeDuration', 'timeCycle', 'timeDate']).optional().describe('Timer type'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools. (ignored for BoundaryEvent)'),
});

export const addSubprocessSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  type: z.enum(['bpmn:SubProcess', 'bpmn:CallActivity']).default('bpmn:SubProcess').describe('Sub-process type'),
  name: z.string().default('').describe('Label'),
  x: z.number().default(350).describe('Canvas x coordinate'),
  y: z.number().default(150).describe('Canvas y coordinate'),
  width: z.number().default(350).describe('Width'),
  height: z.number().default(200).describe('Height'),
  collapsed: z.boolean().default(false).describe('Collapsed sub-process'),
  calledElement: z.string().optional().describe('Process ID to call (for CallActivity)'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools.'),
});

export const setPropertiesSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element to configure'),
  name: z.string().optional().describe('Element name'),
  documentation: z.string().optional().describe('Documentation text'),
  conditionExpression: z.string().optional().describe('FEEL/JUEL condition for sequence flows'),
  implementationType: z.enum(['class', 'delegateExpression', 'expression', 'external', 'connector']).optional()
    .describe('Camunda 7 ServiceTask implementation type'),
  implementationValue: z.string().optional().describe('Class name, expression, or connector ID'),
  taskTopic: z.string().optional().describe('External task topic (Camunda 7)'),
  taskPriority: z.string().optional().describe('Task priority'),
  taskType: z.string().optional().describe('Zeebe job type (Camunda 8). Required by Camunda validation for ServiceTask, SendTask, BusinessRuleTask, and ScriptTask — not just ServiceTask.'),
  taskRetries: z.string().optional().describe('Zeebe retry count'),
  correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for a ReceiveTask, or a boundary/intermediate catch event with a message reference — required by Camunda validation alongside messageRef.'),
  isExecutable: z.boolean().optional().describe('Process isExecutable flag'),
});

export const setIoMappingSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element'),
  inputs: z.array(z.object({
    source: z.string().describe('Source expression'),
    target: z.string().describe('Target variable name'),
  })).optional().describe('Input mappings'),
  outputs: z.array(z.object({
    source: z.string().describe('Source expression'),
    target: z.string().describe('Target variable name'),
  })).optional().describe('Output mappings'),
});

export const setTaskHeadersSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element'),
  headers: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })).describe('Key-value headers'),
});

export const listElementsSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  typeFilter: z.string().optional().describe('Filter by BPMN type prefix, e.g. "bpmn:Task"'),
  parentId: z.string().optional().describe('Filter to elements inside this expanded subprocess'),
  fields: z.array(z.string()).optional().describe('Fields to include per element: id, type, name, x, y, width, height, parentId, incoming, outgoing. Defaults to all. id is always included.'),
});

export const getElementSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element'),
});

export const deleteElementSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element to delete'),
});

export const getDiagramXmlSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
});

export const importXmlSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  xml: z.string().describe('Complete BPMN 2.0 XML to import'),
});

/**
 * Zod schema for the set_execution_platform_version tool.
 * Corrects the target Camunda 8 execution platform version on whichever
 * diagram is currently open — needed because not every diagram is created
 * via create_model (e.g. one authored directly in Modeler and only
 * populated via MCP tools afterward carries no version stamp from this
 * plugin at all).
 */
export const setExecutionPlatformVersionSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  version: z.string().describe('Target execution platform version, e.g. "8.10" or "8.10.0", matching your connected Zeebe cluster.'),
  platform: z.string().default('Camunda Cloud').describe('Execution platform name (default "Camunda Cloud").'),
});

// ---------------------------------------------------------------------------
// v0.3 schemas
// ---------------------------------------------------------------------------

export const moveElementSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element to move'),
  x: z.number().describe('New x coordinate (center)'),
  y: z.number().describe('New y coordinate (center)'),
});

export const saveDiagramSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  filePath: z.string().describe('Absolute file path to save the .bpmn file to'),
});

export const addParticipantSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  name: z.string().default('').describe('Pool name'),
  x: z.number().default(400).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  width: z.number().default(600).describe('Pool width'),
  height: z.number().default(250).describe('Pool height'),
});

export const addLaneSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  participantId: z.string().describe('ID of the participant (pool) to add the lane to'),
  name: z.string().default('').describe('Lane name'),
});

export const addEndEventTypedSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  eventDefinitionType: z.enum([
    'bpmn:ErrorEventDefinition', 'bpmn:EscalationEventDefinition',
    'bpmn:SignalEventDefinition', 'bpmn:MessageEventDefinition',
    'bpmn:TerminateEventDefinition', 'none',
  ]).default('none').describe('End event definition type'),
  name: z.string().default('').describe('Label'),
  x: z.number().default(600).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
  parentId: z.string().optional().describe('ID of a parent expanded subprocess or participant/pool — element is created as a child of that subprocess/pool instead of the root process. Required when the diagram has 2+ pools.'),
  errorRef: z.string().optional().describe('For eventDefinitionType bpmn:ErrorEventDefinition: error name. Find-or-creates a bpmn:Error root element (required by Camunda validation).'),
  errorCode: z.string().optional().describe('errorCode when find-or-creating the bpmn:Error referenced by errorRef. Camunda requires a non-empty errorCode on any error reference; defaults to the errorRef name if omitted.'),
  messageRef: z.string().optional().describe('For eventDefinitionType bpmn:MessageEventDefinition: message name. Find-or-creates a bpmn:Message root element.'),
  correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for eventDefinitionType bpmn:MessageEventDefinition — required by Camunda validation alongside messageRef.'),
  signalRef: z.string().optional().describe('For eventDefinitionType bpmn:SignalEventDefinition: signal name. Find-or-creates a bpmn:Signal root element.'),
  escalationRef: z.string().optional().describe('For eventDefinitionType bpmn:EscalationEventDefinition: escalation name. Find-or-creates a bpmn:Escalation root element.'),
  escalationCode: z.string().optional().describe('escalationCode when find-or-creating the bpmn:Escalation referenced by escalationRef. Defaults to the escalationRef name if omitted.'),
});

export const addMessageFlowSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  sourceId: z.string().describe('ID of the source element'),
  targetId: z.string().describe('ID of the target element'),
  name: z.string().optional().describe('Label for the message flow'),
});

export const addAnnotationSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  text: z.string().describe('Annotation text'),
  x: z.number().default(400).describe('Canvas x coordinate'),
  y: z.number().default(100).describe('Canvas y coordinate'),
  attachToId: z.string().optional().describe('Element ID to associate the annotation with'),
});

// ---------------------------------------------------------------------------
// v0.5 schemas
// ---------------------------------------------------------------------------

export const createDmnSchema = z.object({
  name: z.string().describe('Name for the DMN file'),
  tableName: z.string().default('Decision').describe('Decision table name'),
  hitPolicy: z.enum(['UNIQUE', 'FIRST', 'PRIORITY', 'ANY', 'COLLECT', 'RULE ORDER']).default('UNIQUE'),
  inputs: z.array(z.object({
    label: z.string(),
    expression: z.string().describe('Input expression (e.g. variable name)'),
    type: z.string().default('string').describe('Type: string, integer, boolean, double, date'),
  })).optional(),
  outputs: z.array(z.object({
    label: z.string(),
    name: z.string().describe('Output variable name'),
    type: z.string().default('string'),
  })).optional(),
});

export const deployProcessSchema = z.object({
  filePath: z.string().describe('Path to the .bpmn file to deploy'),
  clusterUrl: z.string().optional().describe('Zeebe cluster URL (defaults to ZEEBE_ADDRESS env var)'),
  clientId: z.string().optional().describe('OAuth client ID (defaults to ZEEBE_CLIENT_ID env var)'),
  clientSecret: z.string().optional().describe('OAuth client secret (defaults to ZEEBE_CLIENT_SECRET env var)'),
});

export const resizeElementSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element to resize'),
  width: z.number().describe('New width in pixels'),
  height: z.number().describe('New height in pixels'),
});

export const setFlowWaypointsSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  flowId: z.string().describe('ID of the existing sequence flow or message flow'),
  waypoints: z.array(z.object({
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
  })).min(2).describe('New routing path including source and target connection points (minimum 2 points)'),
});

export const autoLayoutSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().optional().describe('Scope layout to a specific expanded subprocess. If omitted, layouts the entire diagram.'),
  options: z.object({
    branchSpacing: z.number().default(140).describe('Vertical pixels between gateway branches'),
    horizontalSpacing: z.number().default(80).describe('Pixels between sequential elements'),
    flowRouting: z.enum(['orthogonal', 'direct']).default('orthogonal').describe('Connection routing style'),
    mergeAlignment: z.enum(['center', 'top-branch']).default('center').describe('Where merge gateways align vertically'),
    boundaryEventPosition: z.enum(['bottom', 'bottom-right']).default('bottom').describe('Default boundary event placement'),
  }).optional().describe('Layout options'),
});

export const getElementBoundsSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element'),
});

export const cloneElementSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  sourceId: z.string().describe('ID of the element to clone'),
  name: z.string().optional().describe('Override the name on the cloned element'),
  x: z.number().describe('X position for the clone'),
  y: z.number().describe('Y position for the clone'),
  deep: z.boolean().default(false).describe('For expanded subprocesses, also clone all child elements and internal flows'),
});

export const batchOperationsSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  operations: z.array(z.object({
    tool: z.string().describe('Tool name to execute (e.g. "move_element", "connect_elements", "delete_element", "set_properties", "resize_element", "add_task", "add_gateway", "add_event")'),
    params: z.record(z.string(), z.unknown()).describe('Parameters matching the individual tool schema'),
  })).min(1).describe('Ordered list of operations to execute. Use "$ref:N" as a string value to reference the elementId/connectionId returned by operation at index N.'),
});

export const addGroupSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  name: z.string().optional().describe('Label displayed on the group'),
  x: z.number().default(200).describe('Top-left x coordinate'),
  y: z.number().default(200).describe('Top-left y coordinate'),
  width: z.number().default(400).describe('Group width'),
  height: z.number().default(200).describe('Group height'),
  categoryValue: z.string().optional().describe('BPMN category value for the group'),
});

export const exportImageSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  filePath: z.string().describe('Absolute file path to save the image (e.g. /tmp/diagram.png)'),
  format: z.enum(['svg', 'png']).default('png').describe('Image format'),
  scale: z.number().default(2).describe('Scale factor for PNG export (1 = 96dpi, 2 = 192dpi for retina)'),
});

export const buildProcessSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elements: z.array(z.object({
    id: z.string().describe('Logical ID for cross-referencing in flows — the actual bpmn-js ID is generated and returned in idMap'),
    type: z.enum([
      'startEvent', 'endEvent', 'task', 'userTask', 'serviceTask', 'sendTask',
      'receiveTask', 'scriptTask', 'businessRuleTask', 'manualTask',
      'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway',
      'subprocess', 'callActivity',
      'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
      'endEventError', 'endEventTerminate', 'endEventSignal', 'endEventMessage', 'endEventEscalation',
      'textAnnotation', 'group',
    ]).describe('Element type'),
    name: z.string().optional().describe('Element label'),
    x: z.number().optional().describe('Canvas x coordinate (auto-assigned if omitted)'),
    y: z.number().optional().describe('Canvas y coordinate (defaults to 200 if omitted)'),
    parentId: z.string().optional().describe('Logical ID of parent expanded subprocess'),
    properties: z.object({
      conditionExpression: z.string().optional(),
      taskType: z.string().optional().describe('Zeebe job type — required by Camunda validation for serviceTask, sendTask, businessRuleTask, and scriptTask (not just serviceTask).'),
      taskRetries: z.string().optional(),
      documentation: z.string().optional(),
      implementationType: z.enum(['class', 'delegateExpression', 'expression', 'external', 'connector']).optional(),
      implementationValue: z.string().optional(),
      isExecutable: z.boolean().optional(),
      errorRef: z.string().optional().describe('For endEventError or an eventDefinitionType of bpmn:ErrorEventDefinition: error name. Find-or-creates a bpmn:Error root element (required by Camunda validation).'),
      errorCode: z.string().optional().describe('errorCode when find-or-creating the bpmn:Error referenced by errorRef. Camunda requires a non-empty errorCode on any error reference; defaults to the errorRef name if omitted.'),
      messageRef: z.string().optional().describe('For endEventMessage, an eventDefinitionType of bpmn:MessageEventDefinition, or a receiveTask (required)/sendTask (optional): message name. Find-or-creates a bpmn:Message root element.'),
      correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for a receiveTask, or a boundaryEvent/intermediateCatchEvent with eventDefinitionType bpmn:MessageEventDefinition — required by Camunda validation alongside messageRef. Not applicable to startEvent, intermediateThrowEvent, or sendTask.'),
      signalRef: z.string().optional().describe('For endEventSignal or an eventDefinitionType of bpmn:SignalEventDefinition: signal name. Find-or-creates a bpmn:Signal root element.'),
      escalationRef: z.string().optional().describe('For endEventEscalation or an eventDefinitionType of bpmn:EscalationEventDefinition: escalation name. Find-or-creates a bpmn:Escalation root element.'),
      escalationCode: z.string().optional().describe('escalationCode when find-or-creating the bpmn:Escalation referenced by escalationRef. Defaults to the escalationRef name if omitted.'),
      timerValue: z.string().optional().describe('For eventDefinitionType bpmn:TimerEventDefinition (startEvent, intermediate events, boundaryEvent): ISO 8601 timer expression (e.g. PT1H, R/PT5M).'),
      timerType: z.enum(['timeDuration', 'timeCycle', 'timeDate']).optional().describe('Timer type when eventDefinitionType is bpmn:TimerEventDefinition (default timeDuration).'),
    }).optional().describe('Properties to set on the element after creation'),
    width: z.number().optional().describe('Width for subprocesses/groups'),
    height: z.number().optional().describe('Height for subprocesses/groups'),
    collapsed: z.boolean().optional().describe('Collapsed subprocess'),
    calledElement: z.string().optional().describe('Process ID for CallActivity'),
    eventDefinitionType: z.string().optional().describe('Event definition type for startEvent (Message/Signal/Timer only — a process may only have one blank start event), intermediate events, or boundary events.'),
    attachedToId: z.string().optional().describe('Logical ID of host element for BoundaryEvent'),
    cancelActivity: z.boolean().optional().describe('Interrupting boundary event (default true)'),
    boundaryPosition: z.enum(['bottom', 'bottom-left', 'bottom-right', 'top', 'top-left', 'top-right', 'left', 'right']).optional().describe('Where to place boundary event on host edge (default bottom)'),
  })).describe('Elements to create'),
  flows: z.array(z.object({
    from: z.string().describe('Logical ID of source element'),
    to: z.string().describe('Logical ID of target element'),
    name: z.string().optional().describe('Flow label'),
    conditionExpression: z.string().optional().describe('FEEL/JUEL condition'),
    isDefault: z.boolean().optional().describe('Mark as the default flow of its source element. Satisfies validation without a conditionExpression; only one outgoing flow per source can be default.'),
    waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  })).optional().describe('Sequence flows to create between elements'),
  autoLayout: z.boolean().default(true).describe('Apply bpmn-auto-layout after building (default true — recommended: manual x/y placement in this tool has a known unreliable-positioning issue for gateway-to-task connections; see BPMN-BEST-PRACTICES.md). Set false only when placement must exactly match hand-authored coordinates.'),
});

export const validateLayoutSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().optional().describe('Scope validation to a specific subprocess. If omitted, validates the entire diagram.'),
  autoFix: z.boolean().default(false).describe('Automatically apply all generated fixes instead of just reporting them'),
  severity: z.enum(['error', 'warning', 'suggestion']).default('warning').describe('Minimum severity to return'),
});

export const patchElementSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  elementId: z.string().describe('ID of the element to patch'),
  name: z.string().optional().describe('Element name / label'),
  documentation: z.string().optional().describe('Documentation text'),
  conditionExpression: z.string().optional().describe('FEEL/JUEL condition for sequence flows'),
  implementationType: z.enum(['class', 'delegateExpression', 'expression', 'external', 'connector']).optional(),
  implementationValue: z.string().optional(),
  taskTopic: z.string().optional(),
  taskPriority: z.string().optional(),
  taskType: z.string().optional().describe('Zeebe job type (Camunda 8). Required by Camunda validation for ServiceTask, SendTask, BusinessRuleTask, and ScriptTask — not just ServiceTask.'),
  taskRetries: z.string().optional(),
  correlationKey: z.string().optional().describe('FEEL expression (e.g. "=orderId") for a ReceiveTask, or a boundary/intermediate catch event with a message reference — required by Camunda validation alongside messageRef.'),
  isExecutable: z.boolean().optional(),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional().describe('New waypoints for sequence/message flows'),
  x: z.number().optional().describe('Move element to new x center coordinate'),
  y: z.number().optional().describe('Move element to new y center coordinate'),
});

// ---------------------------------------------------------------------------
// Tab management schemas
// ---------------------------------------------------------------------------

export const listOpenDiagramsSchema = z.object({});

export const switchDiagramSchema = z.object({
  diagramId: z.string().optional().describe('Tab ID to switch to (as returned by list_open_diagrams)'),
  filePath: z.string().optional().describe('File path of the .bpmn file'),
  name: z.string().optional().describe('Diagram name (partial match, case-insensitive)'),
});
