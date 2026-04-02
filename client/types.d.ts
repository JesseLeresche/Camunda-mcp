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
