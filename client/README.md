# OpenWAM Visual Model Editor - Frontend

This is the React/TypeScript frontend for the OpenWAM Engine Simulator Web Application's visual model editor.

## Features Implemented

### 4.1 Canvas Editor (React/TypeScript with Konva.js)
- **2D Canvas Implementation**: Built using Konva.js for high-performance 2D graphics
- **Drag & Drop Component Placement**: Components can be dragged from the palette and dropped onto the canvas
- **Simple Icon-based Component Display**: Each OpenWAM component type has a distinct visual representation
- **Grid Background**: Visual grid for precise component alignment
- **Component Selection**: Click to select components with visual highlighting
- **Component Dragging**: Move components around the canvas after placement
- **Keyboard Shortcuts**: Delete key to remove selected components

### 4.2 Component Properties Editor
- **Dynamic Form Generation**: Forms are automatically generated based on component type
- **OpenWAM Property Structure**: Based on actual OpenWAM classes (TTubo, TDeposito, etc.)
- **Real-time Validation**: Input validation with immediate error feedback
- **Type-specific Properties**: Different property sets for pipes, plenums, valves, etc.
- **Validation Rules**: Min/max values, required fields, data type validation

## Component Types Supported

### Pipes (1DPipes)
- **TTubo**: 1D pipe with full geometric and thermal properties
- **TConcentrico**: Concentric pipe elements

### Boundaries (境界条件)
- **Open End (Atmosphere)**: Atmospheric discharge boundary
- **Closed End**: Sealed pipe end
- **Anechoic End**: Non-reflective boundary
- **Branch**: Pipe branching junction

### Plenums (ODModels)
- **Constant Volume Plenum**: Fixed volume chamber
- **Variable Volume Plenum**: Variable volume chamber
- **Simple Turbine**: Basic turbine model

### Valves (Connections)
- **Fixed CD Valve**: Constant discharge coefficient valve
- **4T Valve**: Four-stroke engine valve
- **Reed Valve**: One-way reed valve

### Engine Components
- **Engine Block**: Main engine assembly
- **4T Cylinder**: Four-stroke cylinder
- **2T Cylinder**: Two-stroke cylinder

## Technical Implementation

### Architecture
- **React 18** with TypeScript for type safety
- **Vite** for fast development and building
- **Konva.js** for 2D canvas rendering
- **Component-based architecture** with clear separation of concerns

### Key Components
- `App.tsx`: Main application container
- `ComponentPalette.tsx`: Draggable component library
- `CanvasEditor.tsx`: Main canvas with Konva.js integration
- `ComponentShape.tsx`: Individual component rendering
- `PropertiesPanel.tsx`: Dynamic property editor
- `Toolbar.tsx`: Application toolbar with actions

### Property Validation
- Real-time validation based on OpenWAM constraints
- Type-specific validation rules (min/max, required fields)
- Visual error feedback with detailed messages
- Automatic property updates on valid input

## Usage

1. **Start Development Server**:
   ```bash
   npm run dev
   ```

2. **Build for Production**:
   ```bash
   npm run build
   ```

3. **Component Placement**:
   - Expand component categories in the left sidebar
   - Drag components onto the canvas
   - Click to select and edit properties

4. **Property Editing**:
   - Select a component on the canvas
   - Edit properties in the right panel
   - Validation errors appear immediately

## Requirements Fulfilled

- **要件 7.1**: Drag & drop visual model editor ✓
- **要件 7.5**: Simple icon-based 2D display with zoom/pan ✓
- **要件 2.2**: OpenWAM property structure integration ✓
- **要件 2.3**: Real-time validation and error display ✓
- **要件 7.4**: Dynamic property editing interface ✓

## Next Steps

The visual model editor frontend is now complete and ready for integration with:
- Backend API for model persistence
- OpenWAM file generation system
- Simulation execution workflow
- Results visualization components