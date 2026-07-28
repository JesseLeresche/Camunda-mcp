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
      openDiagram: (filePath: string) => Promise<{ id: string; name: string; filePath?: string }>;
      autoLayout: () => Promise<{ applied: boolean }>;
    };
    // Kept in sync with app.activeTabChanged so routeDispatch (bpmn-tools.ts)
    // can tell, from inside a per-tab bpmn-js module, whether a requested
    // diagramId is actually the active tab — the two plugin surfaces mount
    // independently and have no other shared reference to compare against.
    __mcpActiveTabId?: string | null;
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
        window.__mcpActiveTabId = activeTab.id;
      }
    });

    // Expose tab manager globally for main process access via executeJavaScript
    window.__mcpTabManager = {
      listTabs: () => this.listTabs(),
      switchTab: (params) => this.switchTab(params),
      openDiagram: (filePath) => this.openDiagram(filePath),
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
    const targetPath = target.file?.path;

    // Camunda Modeler's triggerAction('select-tab', ...) only supports
    // relative 'next'/'previous' navigation — there is no plugin action to
    // activate an arbitrary already-open tab by reference. The only
    // reachable path that both finds-or-opens AND activates (via
    // App#openFiles -> App#showTab) a specific tab is 'open-diagram' with a
    // file path, which requires the tab to actually be saved to disk.
    if (!targetPath) {
      throw new Error(
        `Cannot switch to tab "${target.name || target.title || 'Untitled'}" — it has no ` +
        `saved file path, and Camunda Modeler's plugin API has no action to activate an ` +
        `already-open tab by reference (only by file path, or relative next/previous). ` +
        `Save the diagram first, or switch to it manually in the Modeler UI.`
      );
    }

    const { triggerAction } = this.props;
    await triggerAction('open-diagram', { path: targetPath });

    return {
      switched: true,
      tabId: target.id,
      name: target.name || target.title || 'Untitled',
      filePath: targetPath,
    };
  }

  /**
   * Opens (or focuses, if already open) a file by path via Modeler's own
   * 'open-diagram' action — unlike shell.openPath(), this never touches the
   * OS file-association layer, so it can't get stuck behind an "open with"
   * picker for unassociated file types.
   */
  private async openDiagram(filePath: string): Promise<{ id: string; name: string; filePath?: string }> {
    const { triggerAction } = this.props;
    await triggerAction('open-diagram', { path: filePath });

    // app.activeTabChanged may land asynchronously relative to triggerAction's
    // resolution — poll briefly for the new tab to register.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const activeTab = this._activeTabId ? this._tabs.get(this._activeTabId) : undefined;
      if (activeTab?.file?.path === filePath) {
        return {
          id: activeTab.id,
          name: activeTab.name || activeTab.title || 'Untitled',
          filePath: activeTab.file?.path,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`open-diagram completed but no tab for "${filePath}" registered within 3s`);
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
