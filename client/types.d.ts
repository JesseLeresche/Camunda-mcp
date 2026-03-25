declare module 'camunda-modeler-plugin-helpers' {
  export function registerClientPlugin(plugin: any, type: string): void;
  export function registerClientExtension(component: any): void;
  export function registerBpmnJSPlugin(module: any): void;
  export function registerPlatformBpmnJSPlugin(module: any): void;
  export function registerCloudBpmnJSPlugin(module: any): void;
  export function registerBpmnJSModdleExtension(descriptor: any): void;
}
