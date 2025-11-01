# OpenWAM Web Application

A modern web-based interface for the OpenWAM engine simulation software, providing an intuitive way to create, configure, and run engine simulations through a browser-based interface.

## Features

- **Visual Model Editor**: Drag-and-drop interface for building engine models
- **Real-time Simulation**: Monitor simulation progress with live updates
- **File Management**: Upload/download OpenWAM files and results
- **Project Management**: Organize simulations into projects
- **Results Visualization**: Interactive charts and data analysis
- **Local Deployment**: Runs entirely on your local machine

## Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenWAM executable (for running simulations)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd openwam-webapp
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment configuration:
```bash
cp .env.example .env
```

4. Edit `.env` file with your configuration

## Development

Start the development server:
```bash
npm run dev
```

This will start:
- Backend server on http://localhost:5000
- Frontend development server on http://localhost:3000

## Building for Production

Build the application:
```bash
npm run build
```

Start the production server:
```bash
npm start
```

## Testing

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Project Structure

```
├── src/
│   ├── server/          # Backend Node.js/Express server
│   │   ├── database/    # Database management
│   │   ├── routes/      # API routes
│   │   ├── socket/      # WebSocket handlers
│   │   ├── middleware/  # Express middleware
│   │   └── utils/       # Utilities
│   └── shared/          # Shared types and constants
├── client/              # Frontend React application (to be created)
├── app_data/            # Application data and database
├── uploads/             # Uploaded files
└── logs/                # Application logs
```

## API Documentation

### Projects
- `GET /api/projects` - Get all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project by ID
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Simulations
- `GET /api/simulations/:id` - Get simulation status
- `POST /api/simulations` - Start new simulation
- `PUT /api/simulations/:id` - Update simulation
- `DELETE /api/simulations/:id` - Cancel simulation

### Files
- `POST /api/files/upload` - Upload file
- `GET /api/files/:id/download` - Download file
- `DELETE /api/files/:id` - Delete file

### System
- `GET /api/system/status` - Get system status
- `GET /api/system/health` - Health check
- `GET /api/system/logs` - Get recent logs

## WebSocket Events

The application uses WebSocket for real-time communication:

- `simulation:start` - Start simulation
- `simulation:stop` - Stop simulation
- `simulation:progress` - Simulation progress updates
- `model:validate` - Validate engine model

## License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## Support

For issues and questions, please create an issue in the repository.