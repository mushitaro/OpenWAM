// Re-export shared types for client use
export * from '../../../src/shared/types/openWAMComponents';

// Additional client-specific types
export interface CanvasState {
  zoom: number;
  pan: { x: number; y: number };
  selectedComponent: string | null;
  draggedComponent: string | null;
  isConnecting: boolean;
  connectionStart: { componentId: string; portId: string } | null;
}

export interface CanvasComponent {
  id: string;
  type: string;
  position: { x: number; y: number };
  rotation: number;
  selected: boolean;
  dragging: boolean;
}

export interface ComponentPalette {
  category: string;
  components: ComponentDefinition[];
  expanded: boolean;
}

export interface PropertyFormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'range';
  value: any;
  options?: { value: any; label: string }[];
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
}

// Import the shared types we need
import type { 
  ComponentDefinition
} from '../../../src/shared/types/openWAMComponents';