/**
 * Element-mutation primitive tools: set/resize/move/clone/delete/patch
 * functions that modify existing BPMN shapes/connections.
 */

import {
  type BpmnServices,
  setZeebeTaskDefinition, setMessageSubscription,
} from '../element-shared';

export function setProperties(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const basicProps: any = {};
  if (params.name !== undefined) basicProps.name = params.name;
  if (params.documentation !== undefined) {
    const doc = moddle.create('bpmn:Documentation', { text: params.documentation as string });
    basicProps.documentation = [doc];
  }
  if (params.isExecutable !== undefined) basicProps.isExecutable = params.isExecutable;
  if (params.conditionExpression !== undefined) {
    const expr = moddle.create('bpmn:FormalExpression', { body: params.conditionExpression as string });
    basicProps.conditionExpression = expr;
  }
  if (Object.keys(basicProps).length > 0) {
    modeling.updateProperties(element, basicProps);
  }

  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  if (params.implementationType && hasCamunda) {
    const implType = params.implementationType as string;
    const implValue = (params.implementationValue as string) || '';
    const camundaProps: any = {
      'camunda:class': undefined, 'camunda:delegateExpression': undefined,
      'camunda:expression': undefined, 'camunda:type': undefined, 'camunda:topic': undefined,
    };
    switch (implType) {
      case 'class': camundaProps['camunda:class'] = implValue; break;
      case 'delegateExpression': camundaProps['camunda:delegateExpression'] = implValue; break;
      case 'expression': camundaProps['camunda:expression'] = implValue; break;
      case 'external':
        camundaProps['camunda:type'] = 'external';
        camundaProps['camunda:topic'] = (params.taskTopic as string) || implValue;
        break;
    }
    if (params.taskPriority) camundaProps['camunda:taskPriority'] = params.taskPriority;
    modeling.updateProperties(element, camundaProps);
  }

  if (params.taskType && hasZeebe) {
    setZeebeTaskDefinition(moddle, modeling, element, params.taskType as string, params.taskRetries as string | undefined);
  }

  if (params.correlationKey && hasZeebe) {
    const messageBo = element.businessObject.messageRef;
    if (messageBo) {
      setMessageSubscription(moddle, messageBo, params.correlationKey as string);
    }
  }

  return { elementId, updated: true };
}

export function setIoMapping(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  const bo = element.businessObject;
  const inputs = (params.inputs as any[]) || [];
  const outputs = (params.outputs as any[]) || [];

  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];

  if (hasZeebe) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:IoMapping');
    const inputParams = inputs.map((i: any) => moddle.create('zeebe:Input', { source: i.source, target: i.target }));
    const outputParams = outputs.map((o: any) => moddle.create('zeebe:Output', { source: o.source, target: o.target }));
    extElements.values.push(moddle.create('zeebe:IoMapping', { inputParameters: inputParams, outputParameters: outputParams }));
  } else if (hasCamunda) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'camunda:InputOutput');
    const inputParams = inputs.map((i: any) => moddle.create('camunda:InputParameter', { name: i.target, value: i.source }));
    const outputParams = outputs.map((o: any) => moddle.create('camunda:OutputParameter', { name: o.target, value: o.source }));
    extElements.values.push(moddle.create('camunda:InputOutput', { inputParameters: inputParams, outputParameters: outputParams }));
  } else {
    throw new Error('No zeebe or camunda moddle extension found');
  }

  modeling.updateProperties(element, { extensionElements: extElements });
  return { elementId, inputCount: inputs.length, outputCount: outputs.length };
}

export function setTaskHeaders(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  const bo = element.businessObject;
  const headers = (params.headers as any[]) || [];

  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];

  if (hasZeebe) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:TaskHeaders');
    const headerEntries = headers.map((h: any) => moddle.create('zeebe:Header', { key: h.key, value: h.value }));
    extElements.values.push(moddle.create('zeebe:TaskHeaders', { values: headerEntries }));
  } else if (hasCamunda) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'camunda:Properties');
    const props = headers.map((h: any) => moddle.create('camunda:Property', { name: h.key, value: h.value }));
    extElements.values.push(moddle.create('camunda:Properties', { values: props }));
  } else {
    throw new Error('No zeebe or camunda moddle extension found');
  }

  modeling.updateProperties(element, { extensionElements: extElements });
  return { elementId, headerCount: headers.length };
}

export function deleteElement(params: Record<string, unknown>, { modeling, elementRegistry }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  modeling.removeElements([element]);
  return { deleted: true, elementId };
}

export function resizeElement(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const newWidth = params.width as number;
  const newHeight = params.height as number;

  // Keep the element centered: compute new bounds from center point
  const centerX = element.x + (element.width || 0) / 2;
  const centerY = element.y + (element.height || 0) / 2;
  const newBounds = {
    x: centerX - newWidth / 2,
    y: centerY - newHeight / 2,
    width: newWidth,
    height: newHeight,
  };

  modeling.resizeShape(element, newBounds);

  return {
    elementId,
    width: element.width,
    height: element.height,
    x: element.x,
    y: element.y,
    centerX: element.x + element.width / 2,
    centerY: element.y + element.height / 2,
  };
}

export function moveElement(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const newX = params.x as number;
  const newY = params.y as number;

  // Calculate delta from current position
  // For shapes, element.x/y is top-left. We need to calculate based on center.
  const currentCenterX = element.x + (element.width || 0) / 2;
  const currentCenterY = element.y + (element.height || 0) / 2;
  const deltaX = newX - currentCenterX;
  const deltaY = newY - currentCenterY;

  modeling.moveElements([element], { x: deltaX, y: deltaY });

  return {
    elementId,
    x: element.x,
    y: element.y,
    centerX: element.x + (element.width || 0) / 2,
    centerY: element.y + (element.height || 0) / 2,
  };
}

export function setFlowWaypoints(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const flowId = params.flowId as string;
  const waypoints = params.waypoints as Array<{ x: number; y: number }>;

  const connection = elementRegistry.get(flowId);
  if (!connection) throw new Error(`Flow "${flowId}" not found`);

  const bo = connection.businessObject;
  if (bo.$type !== 'bpmn:SequenceFlow' && bo.$type !== 'bpmn:MessageFlow') {
    throw new Error(`Element "${flowId}" is a ${bo.$type}, not a sequence/message flow`);
  }

  const newWaypoints = waypoints.map(wp => ({ x: wp.x, y: wp.y }));

  if (typeof modeling.updateWaypoints === 'function') {
    modeling.updateWaypoints(connection, newWaypoints);
  } else {
    // Fall back to layoutConnection which goes through the command stack
    modeling.layoutConnection(connection, {
      connectionStart: newWaypoints[0],
      connectionEnd: newWaypoints[newWaypoints.length - 1],
    });
  }

  return {
    flowId,
    waypoints: connection.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y })),
  };
}

export function cloneElement(
  params: Record<string, unknown>,
  { modeling, elementRegistry, canvas, moddle, bpmnFactory }: BpmnServices
) {
  const sourceId = params.sourceId as string;
  const overrideName = params.name as string | undefined;
  const x = params.x as number;
  const y = params.y as number;
  const deep = (params.deep as boolean) || false;

  const source = elementRegistry.get(sourceId);
  if (!source) throw new Error(`Source element "${sourceId}" not found`);

  const bo = source.businessObject;

  // Create shape with same type and dimensions
  const shapeAttrs: any = { type: source.type };
  if (bo.$type === 'bpmn:SubProcess') {
    shapeAttrs.isExpanded = source.isExpanded ?? source.di?.isExpanded ?? false;
  }

  const parent = source.parent || canvas.getRootElement();
  const clone = modeling.createShape(
    shapeAttrs,
    { x, y, width: source.width, height: source.height },
    parent,
  );

  // Copy simple business object properties
  const propsToClone: any = {};
  for (const key of Object.keys(bo)) {
    if (key.startsWith('$') || ['id', 'di', 'flowElements', 'artifacts', 'laneSets'].includes(key)) continue;
    if (['incoming', 'outgoing', 'sourceRef', 'targetRef'].includes(key)) continue;
    if (key === 'extensionElements') continue; // handled separately
    const val = bo[key];
    if (val !== undefined && val !== null && typeof val !== 'object') {
      propsToClone[key] = val;
    }
  }

  // Override name if provided
  if (overrideName !== undefined) {
    propsToClone.name = overrideName;
  }

  if (Object.keys(propsToClone).length > 0) {
    modeling.updateProperties(clone, propsToClone);
  }
  if (propsToClone.name || overrideName) {
    modeling.updateLabel(clone, propsToClone.name || overrideName);
  }

  // Copy extension elements
  if (bo.extensionElements?.values?.length > 0) {
    const cloneBo = clone.businessObject;
    if (!cloneBo.extensionElements) {
      cloneBo.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
      cloneBo.extensionElements.$parent = cloneBo;
    }
    for (const ext of bo.extensionElements.values) {
      try {
        const clonedExt = JSON.parse(JSON.stringify(ext, (k, v) => k.startsWith('$') && k !== '$type' ? undefined : v));
        const newExt = moddle.create(ext.$type, clonedExt);
        newExt.$parent = cloneBo.extensionElements;
        cloneBo.extensionElements.values.push(newExt);
      } catch {
        // Skip extensions that can't be cloned
      }
    }
  }

  // Copy condition expression for sequence flows
  if (bo.conditionExpression) {
    const expr = moddle.create('bpmn:FormalExpression', { body: bo.conditionExpression.body });
    modeling.updateProperties(clone, { conditionExpression: expr });
  }

  const result: any = {
    elementId: clone.id,
    sourceId,
    type: clone.type,
    x: clone.x,
    y: clone.y,
  };

  // Deep clone: copy children of expanded subprocess
  if (deep && bo.$type === 'bpmn:SubProcess' && shapeAttrs.isExpanded) {
    const childIds: string[] = [];
    const idMap: Record<string, string> = {};
    const children = (source.children || []).filter(
      (child: any) => child.type !== 'label'
    );

    // Clone child shapes
    for (const child of children) {
      if (child.waypoints) continue; // skip connections, handle after
      const childClone = modeling.createShape(
        { type: child.type },
        { x: child.x + (x - source.x), y: child.y + (y - source.y), width: child.width, height: child.height },
        clone,
      );
      idMap[child.id] = childClone.id;
      childIds.push(childClone.id);

      // Copy child name
      const childBo = child.businessObject;
      if (childBo.name) {
        modeling.updateLabel(childClone, childBo.name);
      }
    }

    // Clone internal connections
    for (const child of children) {
      if (!child.waypoints) continue;
      const srcId = idMap[child.source?.id];
      const tgtId = idMap[child.target?.id];
      if (srcId && tgtId) {
        const src = elementRegistry.get(srcId);
        const tgt = elementRegistry.get(tgtId);
        if (src && tgt) {
          const conn = modeling.connect(src, tgt);
          childIds.push(conn.id);
        }
      }
    }

    result.childIds = childIds;
  }

  return result;
}

/**
 * Sets or corrects the target Camunda 8 execution platform version on the
 * currently open diagram's bpmn:definitions. Needed because not every
 * diagram is created via create_model — one authored directly in Modeler and
 * only populated via MCP tools afterward carries no version stamp from this
 * plugin at all, and would otherwise silently keep whichever version
 * Modeler's own "New Diagram" default assigned it.
 */
// KNOWN LIMITATION: this mutates the bpmn:definitions moddle object directly
// (executionPlatform/executionPlatformVersion), and the mutation demonstrably
// lands on the exact object bpmnjs.getDefinitions() returns — confirmed via
// live readback — yet Modeler's exported/saved XML still shows the old
// version. The modeler: namespace attributes appear to be owned by Camunda
// Modeler's own app-level layer (outside bpmn-js/moddle's normal
// property-driven XML writer), similar to how tab-switching required
// Modeler's triggerAction API rather than direct DOM/state manipulation.
// No Modeler-level API for this has been found yet. See issue #3 for the
// full investigation writeup.
export function setExecutionPlatformVersion(
  params: Record<string, unknown>,
  { canvas }: BpmnServices
) {
  const version = params.version as string;
  const platform = (params.platform as string) || 'Camunda Cloud';

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open');

  const definitions = rootElement.businessObject?.$parent;
  if (!definitions) throw new Error('Could not resolve bpmn:definitions for the open diagram');

  definitions.executionPlatform = platform;
  definitions.executionPlatformVersion = version;

  return {
    executionPlatform: platform,
    executionPlatformVersion: version,
  };
}

export function patchElement(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = services.elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const patched: string[] = [];

  // Properties (reuse setProperties logic)
  const propKeys = [
    'name', 'documentation', 'conditionExpression', 'implementationType',
    'implementationValue', 'taskTopic', 'taskPriority', 'taskType',
    'taskRetries', 'correlationKey', 'isExecutable',
  ];
  const hasProps = propKeys.some(k => params[k] !== undefined);
  if (hasProps) {
    setProperties({ ...params, elementId }, services);
    patched.push(...propKeys.filter(k => params[k] !== undefined));
  }

  // Update visual label when name changes (setProperties only sets the BO property)
  if (params.name !== undefined) {
    services.modeling.updateLabel(element, params.name as string);
  }

  // Waypoints
  if (params.waypoints) {
    setFlowWaypoints({ flowId: elementId, waypoints: params.waypoints }, services);
    patched.push('waypoints');
  }

  // Position
  if (params.x !== undefined || params.y !== undefined) {
    const cx = element.x + (element.width || 0) / 2;
    const cy = element.y + (element.height || 0) / 2;
    const newX = (params.x as number) ?? cx;
    const newY = (params.y as number) ?? cy;
    moveElement({ elementId, x: newX, y: newY }, services);
    patched.push('position');
  }

  return { elementId, patched };
}
