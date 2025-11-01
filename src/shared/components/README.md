# OpenWAM Component Library Implementation

This document describes the implementation of the OpenWAM Component Library system, which provides a comprehensive framework for defining, validating, and managing OpenWAM engine simulation components.

## Overview

The OpenWAM Component Library is based on actual OpenWAM source code analysis and implements the following key features:

1. **Component Definition System** - Type-safe component definitions based on actual OpenWAM C++ classes
2. **Connection Rules Engine** - Advanced validation system for component connections
3. **Node System Validation** - OpenWAM-specific node numbering and connection constraints
4. **Property Validation** - Dynamic property validation with schemas
5. **Model Templates** - Predefined model configurations for common use cases

## Architecture

```
src/shared/
├── types/
│   └── openWAMComponents.ts     # Core type definitions
├── components/
│   ├── componentDefinitions.ts  # Component definitions
│   ├── componentLibrary.ts     # Library management
│   └── index.ts                # Main exports
├── validation/
│   ├── componentValidator.ts   # Basic validation
│   └── connectionRulesEngine.ts # Advanced validation
└── __tests__/
    ├── componentSystem.test.ts
    └── connectionRulesEngine.test.ts
```

## Key Features

### 1. Component Type System

Based on actual OpenWAM source code analysis, the system defines:

- **Component Categories**: Pipes, Boundaries, Plenums, Valves, Turbocharger, Engine, Control, DPF, External
- **Component Types**: Mapped to actual OpenWAM C++ classes (TTubo, TDeposito, etc.)
- **Boundary Condition Types**: Complete enum mapping from OpenWAM nmTypeBC
- **Valve Types**: Complete enum mapping from OpenWAM nmTipoValvula
- **Property Schemas**: Type-safe property definitions with validation rules

### 2. Connection Rules Engine

Advanced validation system that implements:

- **Basic Connection Rules**: Component-to-component connection permissions
- **Node System Validation**: OpenWAM node numbering constraints (max 3 connections per node)
- **Circular Reference Detection**: DFS-based cycle detection in connection graphs
- **Duplicate Connection Detection**: Prevention of redundant connections
- **OpenWAM-specific Rules**: Boundary condition requirements, model completeness checks

### 3. Property Validation

Dynamic property validation with:

- **Type Validation**: Number, string, boolean, array, select types
- **Range Validation**: Min/max values, ranges, patterns
- **Dependency Validation**: Conditional property display and validation
- **OpenWAM Constraints**: Unique pipe numbers, plenum numbers, node consistency

### 4. Component Library Management

Comprehensive library system with:

- **Component Search**: Name, description, and type-based search
- **Compatibility Checking**: Find components that can connect to specific types
- **Template Management**: Predefined model configurations
- **Custom Components**: Support for user-defined components and rules

## Usage Examples

### Basic Component Creation

```typescript
import { createComponent, ComponentType } from './components';

// Create a pipe component
const pipe = createComponent(
  ComponentType.PIPE,
  'pipe-1',
  { x: 100, y: 100 }
);

// Create a plenum component
const plenum = createComponent(
  ComponentType.CONSTANT_VOLUME_PLENUM,
  'plenum-1',
  { x: 200, y: 100 }
);
```

### Connection Validation

```typescript
import { validateConnection } from './components';

// Validate a connection between components
const result = validateConnection(
  pipeComponent,
  'right',
  plenumComponent,
  'inlet'
);

if (result.isValid) {
  console.log('Connection is valid');
} else {
  console.log('Validation errors:', result.errors);
}
```

### Model Validation

```typescript
import { validateModelWithAdvancedRules } from './components';

// Validate complete model
const result = validateModelWithAdvancedRules(engineModel);

if (result.isValid) {
  console.log('Model is valid for OpenWAM simulation');
} else {
  console.log('Model errors:', result.errors);
  console.log('Model warnings:', result.warnings);
}
```

### Component Library Usage

```typescript
import { getComponentLibrary } from './components';

const library = getComponentLibrary();

// Search for components
const pipeComponents = library.searchComponents('pipe');

// Get components by category
const boundaryComponents = library.getComponentsByCategory(ComponentCategory.BOUNDARIES);

// Check compatibility
const canConnect = library.canConnect(
  ComponentType.PIPE,
  'left',
  ComponentType.OPEN_END_ATMOSPHERE,
  'connection'
);
```

## OpenWAM Integration

The component system is designed to generate valid OpenWAM input files:

### Component Mapping

| Component Type | OpenWAM Class | Description |
|----------------|---------------|-------------|
| `PIPE` | `TTubo` | 1D pipe for gas flow |
| `CONSTANT_VOLUME_PLENUM` | `TDepVolCte` | Constant volume plenum |
| `OPEN_END_ATMOSPHERE` | `TCCDescargaExtremoAbierto` | Atmospheric boundary |
| `CLOSED_END` | `TCCExtremoCerrado` | Closed boundary |
| `FIXED_CD_VALVE` | `TCDFijo` | Fixed discharge coefficient valve |

### Property Mapping

Component properties are mapped directly to OpenWAM input file parameters:

```typescript
// Pipe properties map to OpenWAM TTubo parameters
interface PipeProperties {
  numeroTubo: number;     // FNumeroTubo
  nodoIzq: number;        // FNodoIzq
  nodoDer: number;        // FNodoDer
  nin: number;            // FNin
  longitudTotal: number;  // FLongitudTotal
  // ... other properties
}
```

### Validation Rules

The validation system enforces OpenWAM constraints:

- Maximum 3 connections per node
- Unique pipe and plenum numbers
- Required boundary conditions
- Proper node numbering
- Valid component connections

## Testing

Comprehensive test suite with 34 tests covering:

- Component definition retrieval
- Component instance creation
- Connection validation
- Model validation
- Node system constraints
- Circular reference detection
- Duplicate connection detection
- Property validation
- Template management

Run tests with:
```bash
npm test -- --testPathPattern="componentSystem|connectionRulesEngine"
```

## Future Enhancements

Potential areas for expansion:

1. **Additional Components**: More OpenWAM component types (engines, turbochargers, etc.)
2. **Visual Editor Integration**: Canvas-based drag-and-drop interface
3. **OpenWAM File Generation**: Direct .wam file generation from models
4. **Advanced Templates**: More complex predefined configurations
5. **Custom Validation Rules**: User-defined validation constraints
6. **Performance Optimization**: Caching and optimization for large models

## Dependencies

- TypeScript for type safety
- Jest for testing
- No external runtime dependencies (pure TypeScript/JavaScript)

## License

This implementation is part of the OpenWAM Engine Simulator Web Application and follows the same licensing terms as the parent project.