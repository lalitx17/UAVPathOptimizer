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
