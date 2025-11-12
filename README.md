# SkyServer

Private Admin & Automation Hub for the Sky Ecosystem.

## Overview

- **Automation Daemon** → Background jobs, schedulers, and listeners
- **Private Backend** → Internal Express/Apollo server for admin APIs
- **Frontend (Web)** → Internal web dashboard (React/Vite)
- **Database** → MongoDB or hybrid connectors
- **Telemetry** → Logging and metrics pipeline

## Quick Start

\\\ash
npm init -y
npm install express dotenv
cp .env.example .env
node src/server.js # launch admin server
node src/index.js # run daemon
\\\
