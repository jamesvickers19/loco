# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

React + TypeScript + Vite frontend application using SWC for fast compilation.

Purpose is to compare places to stay by how far they are from every place you want to visit, say on a trip.

**Tech Stack:**

- React 19.1.0 with TypeScript
- Vite 7.0.0 with SWC plugin
- ESLint with TypeScript support

## Architecture

Standard Vite + React structure:

- **Entry**: `src/main.tsx` - React root with StrictMode
- **Main**: `src/App.tsx` - Primary component
- **Config**: Multi-config TypeScript setup (`tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`)

## Key Configuration

- **TypeScript**: Strict mode enabled, ES2022 target, bundler resolution
- **ESLint**: TypeScript + React Hooks + React Refresh rules
- **Build**: TypeScript compilation followed by Vite bundling to `dist/`

## Libraries

Using Mapbox API's for map display, location search, routing calculations.
