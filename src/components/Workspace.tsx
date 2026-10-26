import { ItemList } from './ItemList';
import { VisualizationPanel } from './VisualizationPanel';
import { DirectoryPayload, UiDiskNode } from '../types';

interface WorkspaceProps {
  payload: DirectoryPayload | null;
  onNavigate: (nodeId: number) => void;
  onRefresh: (path?: string) => void;
  onItemTrashed?: (item: UiDiskNode) => void;
}

/** Main workspace region: fills the space left by the header and toolbar. Add new panels here. */
export function Workspace({ payload, onNavigate, onRefresh, onItemTrashed }: WorkspaceProps) {
  return (
    <div className="workspace">
      <ItemList
        payload={payload}
        onNavigate={onNavigate}
        onRefresh={onRefresh}
        onItemTrashed={onItemTrashed}
      />
      <VisualizationPanel payload={payload} onNavigate={onNavigate} />
    </div>
  );
}
