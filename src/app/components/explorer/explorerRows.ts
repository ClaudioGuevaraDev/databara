import type { StoredConnectionDraft } from "../../databaraService";
import type { DatabaseObjectKind, DatabaseTreeNode } from "../../types";
import { connectionKey, serverNodeId } from "../../workspace/workspaceContext.utils";
import { savedConnectionNodeId } from "../../workspace/workspaceCore";

/**
 * One visible sidebar row, with every value the row component needs already
 * resolved. Rendering from a flat list (instead of recursing over the tree in
 * the component) is what makes the rows cheap: the walk below carries the
 * owning server and connection down with it, so no row has to search the tree
 * to find out which connection it belongs to.
 *
 * `selected` is deliberately *not* part of this model — it changes on every
 * click, and keeping it out lets the flattened list stay memoized while only
 * the two affected rows re-render.
 */
export type ExplorerRow = {
  // Unique across the flattened list, and the same key `toggledNodes` uses.
  key: string;
  nodeId: string;
  label: string;
  kind: DatabaseObjectKind;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  isServer: boolean;
  isSavedConnection: boolean;
  selectable: boolean;
  connectionKey: string;
  // Set for saved-connection and database rows: the connection this row acts on.
  storedConnection: StoredConnectionDraft | null;
  connected: boolean;
};

// Lowercased labels for the filter, cached per node object. The filter compares
// every leaf on every keystroke, and the tree nodes only change identity when the
// backend returns a new tree, so the cache survives typing. A WeakMap means
// nothing to invalidate: entries die with their nodes.
const lowercaseLabels = new WeakMap<DatabaseTreeNode, string>();

function lowercaseLabel(node: DatabaseTreeNode): string {
  const cached = lowercaseLabels.get(node);
  if (cached !== undefined) return cached;

  const lowered = node.label.toLowerCase();
  lowercaseLabels.set(node, lowered);
  return lowered;
}

export function flattenExplorerTree({
  connectedConnectionKeys,
  filter,
  storedConnections,
  toggledNodes,
  tree,
}: {
  connectedConnectionKeys: Set<string>;
  filter: string;
  storedConnections: StoredConnectionDraft[];
  toggledNodes: Set<string>;
  tree: DatabaseTreeNode[];
}): ExplorerRow[] {
  // Index the saved connections once, instead of scanning the list per row.
  const byNodeId = new Map<string, StoredConnectionDraft>();
  const byServerDatabase = new Map<string, StoredConnectionDraft>();
  for (const connection of storedConnections) {
    byNodeId.set(savedConnectionNodeId(connection), connection);
    byServerDatabase.set(`${serverNodeId(connection)}|database:${connection.database}`, connection);
  }

  const query = filter.trim().toLowerCase();
  const rows: ExplorerRow[] = [];

  // Returns true when the subtree contributed at least one row, so a container
  // can remove itself again when the filter excludes all of its descendants.
  const walk = (
    nodes: DatabaseTreeNode[],
    depth: number,
    inheritedConnectionKey: string,
    inheritedServerId: string,
  ): boolean => {
    let matched = false;

    for (const node of nodes) {
      const isServer = node.id.startsWith("server:");
      const isSavedConnection = node.id.startsWith("saved-connection:");
      const serverId = isServer ? node.id : inheritedServerId;
      const storedConnection =
        (isSavedConnection
          ? byNodeId.get(node.id)
          : node.id.startsWith("database:")
            ? byServerDatabase.get(`${serverId}|${node.id}`)
            : undefined) ?? null;
      const rowConnectionKey = storedConnection
        ? connectionKey(storedConnection)
        : inheritedConnectionKey;
      const selectable = node.kind === "table" || node.kind === "view";

      // Only leaves are matched against the filter; containers survive through
      // their descendants.
      if (selectable && query && !lowercaseLabel(node).includes(query)) continue;

      const children = node.children ?? [];
      const hasChildren = children.length > 0;
      // Servers start expanded; everything below starts collapsed. `toggledNodes`
      // records flips from that default, so toggling works in both directions.
      const key = `${rowConnectionKey}::${node.id}`;
      const userToggled = toggledNodes.has(key);
      // While filtering, force every branch open so matching tables are visible
      // even under a collapsed schema — without mutating `toggledNodes`, so the
      // real expand/collapse state is restored once the filter clears.
      const collapsed = query ? false : isServer ? userToggled : !userToggled;

      const rowIndex = rows.length;
      rows.push({
        collapsed,
        connected: storedConnection ? connectedConnectionKeys.has(rowConnectionKey) : false,
        connectionKey: rowConnectionKey,
        depth,
        hasChildren,
        isSavedConnection,
        isServer,
        key,
        kind: node.kind,
        label: node.label,
        nodeId: node.id,
        selectable,
        storedConnection,
      });

      const childrenMatched =
        !collapsed && hasChildren ? walk(children, depth + 1, rowConnectionKey, serverId) : false;

      if (query && !selectable && !childrenMatched) {
        // Nothing under this container matched: drop it and anything it pushed.
        rows.length = rowIndex;
        continue;
      }

      matched = true;
    }

    return matched;
  };

  walk(tree, 0, "", "");

  return rows;
}
