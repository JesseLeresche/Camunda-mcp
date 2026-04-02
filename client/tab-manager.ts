/**
 * Camunda Modeler MCP Plugin — Tab Manager client extension.
 *
 * Registers as a Modeler client extension (React component) to gain access
 * to the app-level `subscribe` and `triggerAction` APIs. Tracks open tabs
 * and exposes `window.__mcpTabManager` for the main-process MCP server to
 * call via `webContents.executeJavaScript()`.
 *
 * Limitation: tabs are discovered as they become active. A tab that has
 * never been focused since the plugin loaded won't appear in listTabs()
 * until the user (or switch_diagram) activates it.
 */

import { PureComponent } from 'react';
import { registerClientExtension } from 'camunda-modeler-plugin-helpers';

interface TabInfo {
  id: string;
  name: string;
  type: string;
  filePath?: string;
  isActive: boolean;
}

interface ModelerTab {
  id: string;
  name?: string;
  title?: string;
  type?: string;
  file?: { path?: string };
}

interface TabManagerProps {
  subscribe: (event: string, callback: (data: any) => void) => void;
  triggerAction: (action: string, context?: any) => Promise<any>;
}

declare global {
  interface Window {
    __mcpTabManager?: {
      listTabs: () => TabInfo[];
      switchTab: (params: { diagramId?: string; filePath?: string; name?: string }) => Promise<{
        switched: boolean;
        tabId: string;
        name: string;
        filePath?: string;
      }>;
      autoLayout: () => Promise<{ applied: boolean }>;
    };
  }
}

const LOG_PREFIX = '[camunda-mcp]';

class McpTabExtension extends PureComponent<TabManagerProps> {
  private _tabs: Map<string, ModelerTab> = new Map();
  private _activeTabId: string | null = null;

  componentDidMount() {
    const { subscribe } = this.props;

    // Track active tab changes — primary way we learn about open tabs
    subscribe('app.activeTabChanged', ({ activeTab }: { activeTab: ModelerTab }) => {
      if (activeTab) {
        this._activeTabId = activeTab.id;
        this._tabs.set(activeTab.id, activeTab);
      }
    });

    // Expose tab manager globally for main process access via executeJavaScript
    window.__mcpTabManager = {
      listTabs: () => this.listTabs(),
      switchTab: (params) => this.switchTab(params),
      autoLayout: () => this.autoLayout(),
    };

    console.log(`${LOG_PREFIX} Tab manager initialized`);
  }

  componentWillUnmount() {
    delete window.__mcpTabManager;
  }

  private listTabs(): TabInfo[] {
    const tabs: TabInfo[] = [];
    this._tabs.forEach((tab) => {
      tabs.push({
        id: tab.id,
        name: tab.name || tab.title || 'Untitled',
        type: tab.type || 'unknown',
        filePath: tab.file?.path,
        isActive: tab.id === this._activeTabId,
      });
    });
    return tabs;
  }

  private async switchTab(params: {
    diagramId?: string;
    filePath?: string;
    name?: string;
  }): Promise<{ switched: boolean; tabId: string; name: string; filePath?: string }> {
    const { diagramId, filePath, name } = params;
    const allTabs = Array.from(this._tabs.values());

    if (!diagramId && !filePath && !name) {
      throw new Error('At least one of diagramId, filePath, or name must be provided');
    }

    const matches = allTabs.filter((tab) => {
      if (diagramId && tab.id === diagramId) return true;
      if (filePath && tab.file?.path === filePath) return true;
      if (name) {
        const tabName = (tab.name || tab.title || '').toLowerCase();
        return tabName.includes(name.toLowerCase());
      }
      return false;
    });

    if (matches.length === 0) {
      const known = allTabs.map((t) => ({
        id: t.id,
        name: t.name || t.title,
        filePath: t.file?.path,
      }));
      throw new Error(
        `No matching tab found. Known tabs: ${JSON.stringify(known)}`
      );
    }

    if (matches.length > 1) {
      const matchInfo = matches.map((t) => ({
        id: t.id,
        name: t.name || t.title,
        filePath: t.file?.path,
      }));
      throw new Error(
        `Multiple tabs match — provide a more specific identifier. Matches: ${JSON.stringify(matchInfo)}`
      );
    }

    const target = matches[0];
    const { triggerAction } = this.props;
    await triggerAction('select-tab', { tab: target });

    return {
      switched: true,
      tabId: target.id,
      name: target.name || target.title || 'Untitled',
      filePath: target.file?.path,
    };
  }

  private async autoLayout(): Promise<{ applied: boolean; action?: string; error?: string }> {
    const { triggerAction } = this.props;
    // The action name varies by Camunda Modeler version — try known names
    const actionNames = [
      'formatProcessApplication',
      'format-bpmn-diagram',
      'editor.format',
    ];
    for (const action of actionNames) {
      try {
        await triggerAction(action);
        console.log(`${LOG_PREFIX} Auto-layout applied via action '${action}'`);
        return { applied: true, action };
      } catch {
        // Try next action name
      }
    }
    return {
      applied: false,
      error: `Auto-layout not available — none of the known actions [${actionNames.join(', ')}] are registered in this Modeler version`,
    };
  }

  render() {
    return null;
  }
}

registerClientExtension(McpTabExtension);
