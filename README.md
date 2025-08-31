# UAV Path Optimizer Simulation

## Overview

A comprehensive simulation system for testing drone path optimization algorithms in 3D space. Features real-time visualization, algorithm pluggability, and WebSocket-based communication.

## Project Architecture

### Backend Structure (Python FastAPI + Uvicorn)

The backend follows a **modular architecture** with clear separation of concerns:

```
backend/
├── app/
│   ├── main.py              # FastAPI application entry point
│   ├── models.py            # Pydantic data models
│   └── sim/
│       ├── engine.py        # Simulation engine orchestrator
│       ├── world.py         # World physics and drone movement
│       ├── osm_world.py     # OSM data integration
│       └── algorithms/
│           ├── base.py      # Abstract algorithm interface
│           ├── registry.py  # Algorithm factory pattern
│           ├── straight_line.py
│           └── bandit_mha_star.py
```

**Design Patterns Used:**

1. **Factory Pattern** (`registry.py`): Centralized algorithm registration and instantiation
2. **Strategy Pattern** (`algorithms/`): Pluggable path optimization algorithms
3. **Context Pattern** (`AlgoContext`): Encapsulates algorithm execution context
4. **Dependency Injection**: FastAPI's dependency injection for WebSocket handling

**Key Components:**
- **SimulationEngine**: Orchestrates simulation loop and algorithm execution
- **Algorithm Registry**: Manages available path optimization algorithms
- **WebSocket Handler**: Real-time bidirectional communication
- **World Models**: OSM integration and synthetic city generation

### Frontend Structure (React + TypeScript + Vite)

The frontend follows a **component-based architecture** with modern React patterns:

```
frontend/
├── src/
│   ├── components/
│   │   ├── Controls.tsx     # Simulation control panel
│   │   └── DeckScene.tsx    # 3D visualization component
│   ├── api/
│   │   └── ws.ts           # WebSocket communication layer
│   ├── state/
│   │   └── simStore.ts     # Zustand state management
│   ├── types.ts            # TypeScript type definitions
│   └── App.tsx             # Main application component
```

**Key Components:**
- **SimStore**: Global state management with Zustand
- **WebSocket API**: Real-time communication layer
- **Deck.gl Scene**: 3D visualization with WebGL
- **Control Panel**: User interface for simulation parameters

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





