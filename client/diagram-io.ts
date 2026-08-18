/**
 * Diagram-level I/O primitive tools: XML export/import, save, image export,
 * and validation against Camunda Modeler's own live linting service.
 */

import { type BpmnServices } from './element-shared';

export async function getDiagramXml(_params: Record<string, unknown>, { injector }: BpmnServices) {
  // Access the modeler instance through the injector
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    // Fallback: try to get the bpmnjs instance directly
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance — saveXML not available');
    }
  }
  const { xml } = await modeler.saveXML({ format: true });
  return { xml };
}

export async function importXml(params: Record<string, unknown>, { injector }: BpmnServices) {
  const xml = params.xml as string;
  if (!xml) throw new Error('xml parameter is required');

  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance — importXML not available');
    }
  }
  await modeler.importXML(xml);
  return { imported: true };
}

/**
 * Reads Camunda Modeler's own live linting service — the exact same data
 * backing the Problems panel — instead of reimplementing Camunda's
 * validation rules ourselves. `injector.get('linting')._reports` is an
 * internal, undocumented field (confirmed by direct inspection, not public
 * API), so this degrades gracefully if a future Modeler version renames or
 * restructures it.
 */
export async function validateDiagram(params: Record<string, unknown>, { injector }: BpmnServices) {
  const severityFilter = (params.severity as string) || 'all';

  let lintingSvc: any;
  try {
    lintingSvc = injector.get('linting', false);
  } catch {
    lintingSvc = null;
  }
  if (!lintingSvc) {
    return { issues: [], count: 0, warning: 'Linting service not available in this Modeler version — cannot report validation issues.' };
  }

  // _reports is a cache that only refreshes reactively off a
  // 'commandStack.changed' event — a bulk import_xml doesn't fire one (it
  // bypasses the command stack entirely, unlike incremental modeling.*
  // calls), so without a nudge _update() alone left stale reports (e.g. a
  // false "missing start event") sitting indefinitely, until something else
  // fired that event — clicking an element in the actual Modeler UI does it
  // (proven live). We fire the event ourselves, but linting's own reaction to
  // it isn't done by the time _update()'s first promise resolves — proven
  // live that even 30ms gaps between retries weren't enough, so this backs
  // off up to ~500ms total across a few retries before giving up and
  // returning whatever _reports currently holds.
  try {
    const eventBus = injector.get('eventBus', false);
    eventBus?.fire('commandStack.changed');
  } catch {
    // best-effort nudge — fall through to _update() regardless
  }
  const retryDelaysMs = [40, 80, 160, 220];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const maybePromise = lintingSvc._update?.();
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise;
      }
    } catch {
      // fall back to whatever _reports currently holds
    }
    if (attempt < retryDelaysMs.length) {
      await new Promise<void>((r) => setTimeout(r, retryDelaysMs[attempt]));
    }
  }

  const reports: any[] = Array.isArray(lintingSvc._reports) ? lintingSvc._reports : [];
  const issues = reports
    .filter((r: any) => severityFilter === 'all' || r.category === severityFilter)
    .map((r: any) => ({
      elementId: r.id,
      elementName: r.name,
      message: r.message,
      severity: r.category,
      rule: r.rule,
      docsUrl: r.meta?.documentation?.url,
    }));

  return { issues, count: issues.length };
}

export async function saveDiagram(
  params: Record<string, unknown>,
  { injector }: BpmnServices
) {
  // Renderer side: export the XML. File writing happens on the Node.js side.
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance');
    }
  }
  const { xml } = await modeler.saveXML({ format: true });
  return { xml, filePath: params.filePath };
}

/**
 * Exports the current diagram as SVG or PNG.
 * Returns the image data + metadata; the Node.js handler writes the file.
 */
export async function exportImage(
  params: Record<string, unknown>,
  { injector, canvas }: BpmnServices
) {
  const filePath = params.filePath as string;
  const format = (params.format as string) || 'png';
  const scale = (params.scale as number) || 2;

  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance — saveSVG not available');
    }
  }

  // Get SVG from bpmn-js
  const { svg } = await modeler.saveSVG();

  // Parse dimensions from the SVG viewBox
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  let svgWidth = 800, svgHeight = 600;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number);
    if (parts.length === 4) {
      svgWidth = parts[2];
      svgHeight = parts[3];
    }
  }

  if (format === 'svg') {
    return { data: svg, filePath, format: 'svg', width: svgWidth, height: svgHeight };
  }

  // PNG: rasterize SVG using an offscreen canvas in the Chromium renderer
  const pngWidth = Math.round(svgWidth * scale);
  const pngHeight = Math.round(svgHeight * scale);

  const pngBase64: string = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const offscreen = document.createElement('canvas');
      offscreen.width = pngWidth;
      offscreen.height = pngHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) { reject(new Error('Could not create canvas 2d context')); return; }
      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pngWidth, pngHeight);
      ctx.drawImage(img, 0, 0, pngWidth, pngHeight);
      // Extract base64 PNG (strip the data:image/png;base64, prefix)
      const dataUrl = offscreen.toDataURL('image/png');
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to load SVG into Image for PNG rasterization'));
    // Load SVG as a data URL
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    img.src = URL.createObjectURL(svgBlob);
  });

  return { data: pngBase64, filePath, format: 'png', width: pngWidth, height: pngHeight };
}
