# UAV Path Optimizer Simulation

## Overview

A comprehensive simulation system for testing drone path optimization algorithms in 3D space. Features real-time visualization, multiple optimization algorithms, and WebSocket-based communication.

## Simulation Architecture

### Backend (Python FastAPI + Uvicorn)

- **FastAPI**: High-performance web framework for building APIs
- **Uvicorn**: ASGI server for running the FastAPI application
- **WebSocket**: Real-time communication for simulation ticks
- **Path Optimization Algorithms**: Multiple algorithms for drone path planning

### Frontend (React + Vite + Deck.gl)

- **React 18**: Modern UI framework with hooks
- **Vite**: Fast build tool and development server
- **Deck.gl**: 3D visualization library for drone trajectories
- **Zustand**: Lightweight state management
- **WebSocket**: Real-time data streaming from backend
- **TypeScript**: Type-safe development

## How to Use

### Prerequisites

- **Python 3.10+**: Required for the backend
- **Node.js 18+**: Required for the frontend
- **npm or yarn**: Package manager for Node.js dependencies

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/lalitx17/UAVPathOptimizer.git
   cd UAVPathOptimizer
   ```

2. **Set up the Backend**:
   ```bash
   cd backend
   # Install Python dependencies
   pip install -e .
   # Or if you prefer using a virtual environment:
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -e .
   ```

3. **Set up the Frontend**:
   ```bash
   cd frontend
   # Install Node.js dependencies
   npm install
   # Or using yarn:
   yarn install
   ```

### Running the Application

1. **Start the Backend Server**:
   ```bash
   cd backend
   # Run the FastAPI server with Uvicorn
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   The backend will be available at `http://localhost:8000`

2. **Start the Frontend Development Server**:
   ```bash
   cd frontend
   # Start the Vite development server
   npm run dev
   # Or using yarn:
   yarn dev
   ```
   The frontend will be available at `http://localhost:5173`

3. **Access the Application**:
   - Open your browser and navigate to `http://localhost:5173`
   - The 3D visualization interface will load with the drone simulation

### Using the Simulation

1. **World Generation**:
   - Choose between OSM (OpenStreetMap) data or synthetic city generation
   - For OSM: Provide north, south, east, west coordinates(usually slower)
   - For synthetic: Adjust city width, height, and seed parameters

2. **Algorithm Selection**:
   - Select from available path optimization algorithms
   - Configure algorithm-specific parameters

3. **Simulation Control**:
   - Use the control panel to start/reset the simulation
   - Adjust simulation speed and parameters
   - View real-time drone trajectories in 3D space

### API Endpoints

- `GET /algorithms`: Get available path optimization algorithms
- `POST /world_from_osm`: Generate world from OSM data or synthetic city
- `WS /ws`: WebSocket endpoint for real-time simulation data





