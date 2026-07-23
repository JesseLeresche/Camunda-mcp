declare module 'camunda-modeler-plugin-helpers' {
  export function registerClientPlugin(plugin: any, type: string): void;
  export function registerClientExtension(component: any): void;
  export function registerBpmnJSPlugin(module: any): void;
  export function registerPlatformBpmnJSPlugin(module: any): void;
  export function registerCloudBpmnJSPlugin(module: any): void;
  export function registerBpmnJSModdleExtension(descriptor: any): void;
}

// Minimal React types — React is externalized by CamundaModelerWebpackPlugin
// and provided at runtime by the Camunda Desktop Modeler.
declare module 'react' {
  export class PureComponent<P = any, S = any> {
    props: Readonly<P>;
    state: Readonly<S>;
    constructor(props: P);
    render(): any;
    componentDidMount?(): void;
    componentWillUnmount?(): void;
    setState(state: Partial<S> | ((prevState: S) => Partial<S>)): void;
  }
}

// ELK — declared here so the @ts-ignore import in bpmn-tools.ts has a typed
// fallback. Once elkjs is installed, its own types take over via skipLibCheck.
declare module 'elkjs' {
  interface ELKLayoutOptions {
    [key: string]: string;
  }
  interface ELKNode {
    id: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    layoutOptions?: ELKLayoutOptions;
    children?: ELKNode[];
    edges?: ELKEdge[];
    labels?: Array<{ text: string }>;
  }
  interface ELKEdge {
    id: string;
    sources: string[];
    targets: string[];
    sections?: Array<{
      startPoint: { x: number; y: number };
      endPoint: { x: number; y: number };
      bendPoints?: Array<{ x: number; y: number }>;
    }>;
  }
  interface ELKConstructorOptions {
    defaultLayoutOptions?: ELKLayoutOptions;
    algorithms?: string[];
    workerUrl?: string;
  }
  class ELK {
    constructor(options?: ELKConstructorOptions);
    layout(graph: ELKNode, options?: { layoutOptions?: ELKLayoutOptions }): Promise<ELKNode>;
    knownLayoutOptions(): Promise<any[]>;
    knownLayoutAlgorithms(): Promise<any[]>;
    terminateWorker(): void;
  }
  export default ELK;
}
