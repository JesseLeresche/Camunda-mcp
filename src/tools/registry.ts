import { z } from 'zod';

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
});

/**
 * Zod schema for the add_end_event tool.
 */
export const addEndEventSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  name: z.string().default('').describe('Label for the End Event'),
  x: z.number().default(600).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
});

/**
 * Zod schema for the connect_elements tool.
 */
export const connectElementsSchema = z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  sourceId: z.string().describe('ID of the source element'),
  targetId: z.string().describe('ID of the target element'),
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
  timerValue: z.string().optional().describe('ISO 8601 timer expression (e.g. PT1H, R/PT5M)'),
  timerType: z.enum(['timeDuration', 'timeCycle', 'timeDate']).optional().describe('Timer type'),
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
  taskType: z.string().optional().describe('Zeebe job type (Camunda 8)'),
  taskRetries: z.string().optional().describe('Zeebe retry count'),
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
 * Registry of all MCP tools available in this plugin.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'create_model',
    description:
      'Creates a new empty BPMN diagram tab in the Camunda Desktop Modeler.',
    inputSchema: createModelSchema,
    executeLocal: true,
  },
  {
    name: 'add_start_event',
    description:
      'Places a BPMN Start Event on the canvas of an open diagram.',
    inputSchema: addStartEventSchema,
    executeLocal: false,
  },
  {
    name: 'add_task',
    description:
      'Places a BPMN Task (UserTask, ServiceTask, etc.) on the canvas of an open diagram.',
    inputSchema: addTaskSchema,
    executeLocal: false,
  },
  {
    name: 'add_end_event',
    description:
      'Places a BPMN End Event on the canvas of an open diagram.',
    inputSchema: addEndEventSchema,
    executeLocal: false,
  },
  {
    name: 'connect_elements',
    description:
      'Connects two BPMN elements with a sequence flow.',
    inputSchema: connectElementsSchema,
    executeLocal: false,
  },
  {
    name: 'create_form',
    description:
      'Creates a new Camunda Form (.form) JSON file. Optionally include initial fields.',
    inputSchema: createFormSchema,
    executeLocal: true,
  },
  {
    name: 'add_form_field',
    description:
      'Adds a field to an existing Camunda Form (.form) file.',
    inputSchema: addFormFieldSchema,
    executeLocal: true,
  },
  {
    name: 'link_form_to_task',
    description:
      'Links a Camunda Form to a UserTask by embedding the form JSON in the BPMN model and setting zeebe:formDefinition on the task.',
    inputSchema: linkFormToTaskSchema,
    executeLocal: false,
  },
  // v0.2 tools
  { name: 'add_gateway', description: 'Places a BPMN Gateway (Exclusive, Parallel, Inclusive, EventBased) on the canvas.', inputSchema: addGatewaySchema, executeLocal: false },
  { name: 'add_event', description: 'Places an Intermediate or Boundary Event on the canvas, with optional event definition (Timer, Message, Signal, Error, etc).', inputSchema: addEventSchema, executeLocal: false },
  { name: 'add_subprocess', description: 'Places a Sub-Process or Call Activity on the canvas.', inputSchema: addSubprocessSchema, executeLocal: false },
  { name: 'set_properties', description: 'Sets properties on a BPMN element: name, documentation, conditions, implementation type (Camunda 7 class/delegate/external or Camunda 8 Zeebe job type).', inputSchema: setPropertiesSchema, executeLocal: false },
  { name: 'set_io_mapping', description: 'Sets input/output variable mappings on an element. Supports both Camunda 7 and Camunda 8 formats.', inputSchema: setIoMappingSchema, executeLocal: false },
  { name: 'set_task_headers', description: 'Sets key-value task headers on an element. Camunda 8: zeebe:TaskHeaders. Camunda 7: camunda:Properties.', inputSchema: setTaskHeadersSchema, executeLocal: false },
  { name: 'list_elements', description: 'Lists all BPMN elements in the current diagram with optional type filter.', inputSchema: listElementsSchema, executeLocal: false },
  { name: 'get_element', description: 'Returns detailed information about a specific BPMN element including properties, extensions, and connections.', inputSchema: getElementSchema, executeLocal: false },
  { name: 'delete_element', description: 'Removes an element from the diagram.', inputSchema: deleteElementSchema, executeLocal: false },
  { name: 'get_diagram_xml', description: 'Exports the current diagram as BPMN 2.0 XML.', inputSchema: getDiagramXmlSchema, executeLocal: false },
  { name: 'import_xml', description: 'Imports/replaces the current diagram from BPMN 2.0 XML.', inputSchema: importXmlSchema, executeLocal: false },
];
