/**
 * Read-only introspection primitive tools: list/get/bounds queries against
 * the live element registry.
 */

import { type BpmnServices } from '../element-shared';

export function listElements(params: Record<string, unknown>, { elementRegistry }: BpmnServices) {
  const typeFilter = params.typeFilter as string | undefined;
  const parentId = params.parentId as string | undefined;
  const fields = params.fields as string[] | undefined;
  const allElements = elementRegistry.getAll();

  if (parentId && !elementRegistry.get(parentId)) {
    throw new Error(`Parent element "${parentId}" not found`);
  }

  const filtered = allElements.filter((el: any) => {
    if (el.type && (el.type.startsWith('bpmndi:') || el.type === 'label')) return false;
    if (typeFilter && !el.type?.startsWith(typeFilter)) return false;
    if (parentId && el.parent?.id !== parentId) return false;
    return true;
  });

  const elements = filtered.map((el: any) => {
    const full: Record<string, any> = {
      id: el.id,
      type: el.type,
      name: el.businessObject?.name || null,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      parentId: el.parent?.id || null,
      incoming: (el.incoming || []).map((c: any) => c.id),
      outgoing: (el.outgoing || []).map((c: any) => c.id),
    };
    if (!fields) return full;
    const picked: Record<string, any> = { id: el.id }; // id always included
    for (const f of fields) {
      if (f in full) picked[f] = full[f];
    }
    return picked;
  });

  return { elements, count: elements.length };
}

export function getElement(params: Record<string, unknown>, { elementRegistry }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const bo = element.businessObject;

  // Extract extension elements
  const extensions: any[] = [];
  if (bo.extensionElements?.values) {
    for (const ext of bo.extensionElements.values) {
      const extInfo: any = { $type: ext.$type };
      // Copy simple properties
      for (const key of Object.keys(ext)) {
        if (key.startsWith('$') || key === 'values') continue;
        extInfo[key] = ext[key];
      }
      // Handle nested values (e.g. headers, mappings)
      if (ext.values) {
        extInfo.values = ext.values.map((v: any) => {
          const val: any = { $type: v.$type };
          for (const k of Object.keys(v)) {
            if (!k.startsWith('$')) val[k] = v[k];
          }
          return val;
        });
      }
      extensions.push(extInfo);
    }
  }

  // Incoming/outgoing connections
  const incoming = (element.incoming || []).map((c: any) => ({
    id: c.id, sourceId: c.source?.id
  }));
  const outgoing = (element.outgoing || []).map((c: any) => ({
    id: c.id, targetId: c.target?.id
  }));

  return {
    id: element.id,
    type: element.type,
    name: bo.name || null,
    documentation: bo.documentation?.[0]?.text || null,
    properties: {
      isExecutable: bo.isExecutable,
      conditionExpression: bo.conditionExpression?.body || null,
      // Camunda props
      'camunda:class': bo.get('camunda:class') || null,
      'camunda:delegateExpression': bo.get('camunda:delegateExpression') || null,
      'camunda:type': bo.get('camunda:type') || null,
      'camunda:topic': bo.get('camunda:topic') || null,
      'camunda:formRef': bo.get('camunda:formRef') || null,
    },
    extensionElements: extensions,
    incoming,
    outgoing,
    x: element.x, y: element.y,
    width: element.width, height: element.height,
  };
}

export function getElementBounds(
  params: Record<string, unknown>,
  { elementRegistry }: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const result: any = {
    elementId: element.id,
    type: element.type,
  };

  // For connections (flows), return waypoints
  if (element.waypoints) {
    result.waypoints = element.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y }));
    return result;
  }

  // For shapes, return bounds, center, and connection points
  const x = element.x;
  const y = element.y;
  const width = element.width || 0;
  const height = element.height || 0;

  result.bounds = { x, y, width, height };
  result.center = {
    x: x + width / 2,
    y: y + height / 2,
  };
  result.connectionPoints = {
    top: { x: x + width / 2, y },
    bottom: { x: x + width / 2, y: y + height },
    left: { x, y: y + height / 2 },
    right: { x: x + width, y: y + height / 2 },
  };

  return result;
}
