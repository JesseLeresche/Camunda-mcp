/**
 * Maps each consolidated public tool to its `operation` field and the internal
 * tool name each operation resolves to. Tools not listed here (build_process,
 * batch_operations, create_dmn, deploy_process) are pass-through. The internal
 * names still drive the dispatch switch and the renderer implementations, which
 * are unchanged.
 */
const FACADE: Record<string, { op: string; map: Record<string, string> }> = {
  manage_diagram: {
    op: 'operation',
    map: {
      create: 'create_model', list: 'list_open_diagrams', switch: 'switch_diagram',
      save: 'save_diagram', export_image: 'export_image', import_xml: 'import_xml',
      get_xml: 'get_diagram_xml', set_execution_platform_version: 'set_execution_platform_version',
    },
  },
  add_element: {
    op: 'operation',
    map: {
      start: 'add_start_event', end: 'add_end_event', task: 'add_task',
      gateway: 'add_gateway', event: 'add_event', subprocess: 'add_subprocess',
      pool: 'add_participant', lane: 'add_lane', annotation: 'add_annotation',
      group: 'add_group',
    },
  },
  connect: {
    op: 'operation',
    map: {
      sequence_flow: 'connect_elements', message_flow: 'add_message_flow',
      set_waypoints: 'set_flow_waypoints',
    },
  },
  update_element: {
    op: 'operation',
    map: {
      properties: 'patch_element', move: 'move_element', resize: 'resize_element',
      io_mapping: 'set_io_mapping', headers: 'set_task_headers',
    },
  },
  query_diagram: {
    op: 'operation',
    map: { list: 'list_elements', get: 'get_element', bounds: 'get_element_bounds', validate: 'validate_diagram' },
  },
  manage_element: {
    op: 'operation',
    map: { delete: 'delete_element', clone: 'clone_element' },
  },
  layout: {
    op: 'operation',
    map: { auto: 'auto_layout', validate: 'validate_layout' },
  },
  manage_form: {
    op: 'operation',
    map: { create: 'create_form', add_field: 'add_form_field', link_to_task: 'link_form_to_task' },
  },
};

/**
 * Resolves a consolidated public tool call to the internal tool name + params.
 * - Pass-through for standalone tools and any name not in FACADE.
 * - Strips the `operation` field from params.
 * - add_element `end` upgrades to add_end_event_typed when a (non-none) event
 *   definition is supplied.
 * Returns an `error` message string for an unknown/missing operation.
 */
export function resolveFacade(
  toolName: string,
  params: Record<string, unknown>
): { internalTool: string; params: Record<string, unknown> } | { error: string } {
  const facade = FACADE[toolName];
  if (!facade) return { internalTool: toolName, params };

  const op = params[facade.op];
  if (typeof op !== 'string' || !(op in facade.map)) {
    return { error: `${facade.op}: must be one of [${Object.keys(facade.map).join(', ')}]` };
  }

  let internalTool = facade.map[op];
  const rest = { ...params };
  delete rest[facade.op];

  if (toolName === 'add_element' && op === 'end') {
    const edt = rest.eventDefinitionType;
    if (typeof edt === 'string' && edt !== 'none' && edt !== '') {
      internalTool = 'add_end_event_typed';
    }
  }

  return { internalTool, params: rest };
}
