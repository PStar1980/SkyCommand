# 🌌 SkyServer

**Private Admin & Automation Hub for the Sky Ecosystem**

SkyServer is the central node of the **Sky Ecosystem**, serving as the administrative and automation core that orchestrates build processes, linting, formatting, deployment routines, and data synchronization across local and remote tiers. Designed for precision, maintainability, and self-correction, SkyServer keeps every project clean, compliant, and production-ready.

---

## 🚀 Features

- **Automated Code Quality**
  - Integrated ESLint + Prettier via Husky and lint-staged.
  - Auto-fix and format enforcement on every commit and push.
  - Unified ESLint flat config for modern plugin resolution.

- **Version-Control Integration**
  - Husky pre-commit and pre-push hooks for zero-drift codebase.
  - Seamless auto-restage mechanism for smooth Git operations.
  - Full CI-ready workflow structure.

- **Task Automation (SkyOps Integration Ready)**
  - PowerShell scripts for backend cleanup, frontend cache resets, and repo actions.
  - Build automation tools (`Build-SkyOneBootloader.ps1`, `Git_Repo_Actions.md`, etc.)
  - Symmetric automation flow with lint, test, and push validation.

- **Self-Healing Configuration**
  - Pre-commit and pre-push hooks validate, fix, and re-stage code.
  - Full synchronization with SkyOps and SkyWeb via shared standards.

---

## 🧠 Architecture

```
SkyServer/
│
├── src/
│   ├── config/           # Environment & security settings
│   ├── core/             # Initialization and bootstrap scripts
│   ├── db/               # Database connection and schema utilities
│   ├── scripts/          # PowerShell + Node-based automation tools
│   ├── server/           # Backend controllers, routes, middleware
│   └── web/              # Web components, views, and pages
│
├── .husky/               # Git hook automation
├── .prettierrc.json      # Formatting rules
├── .eslintrc* / eslint.config.mjs  # Lint configuration (FlatConfig)
├── package.json          # Core dependencies and scripts
└── README.md             # This document
```

---

## 🧩 Scripts

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run lint`         | Runs ESLint for static analysis              |
| `npm run lint:fix`     | Auto-fixes linting issues                    |
| `npm run format`       | Applies Prettier formatting                  |
| `npm run format:check` | Validates formatting consistency             |
| `npm run prepush`      | Runs both lint and format checks before push |
| `npm run clean`        | Cleans and formats the repository            |

---

## 🛠️ Pre-Commit & Pre-Push Automation

### `.husky/pre-commit`

Ensures all files are linted and formatted before commit. Automatically re-stages modified files and prevents faulty commits.

### `.husky/pre-push`

Runs a full prepush routine (`npm run lint:fix && npm run format:check`)  
✅ Displays summary of verified files  
✅ Blocks push on failed checks  
✅ Outputs human-readable results

---

## ⚙️ Dependencies

**Core**

- `express` — lightweight Node.js web framework
- `dotenv` — environment variable management

**Dev Dependencies**

- `eslint` / `@eslint/js` / `globals` — linting and config
- `eslint-plugin-prettier` / `eslint-config-prettier` — formatting harmony
- `husky` / `lint-staged` — Git hook automation
- `nodemon` — live reload for development

---

## 🧬 Vision

SkyServer’s design philosophy:

> “Automation should feel like intelligence — quiet, precise, and always one step ahead.”

Each automation layer evolves toward **self-correction** and **self-regulation**. With the upcoming SkyOps merge, SkyServer will transition from a static admin tool into an **autonomous orchestration daemon** that manages SkyOne, SkyWeb, and all connected systems.

---

## 📈 Roadmap

| Phase      | Objective                                                  |
| ---------- | ---------------------------------------------------------- |
| ✅ Phase 1 | ESLint + Prettier integration and Husky hooks              |
| 🔄 Phase 2 | Merge SkyOps automation layer                              |
| 🔜 Phase 3 | Add reporting and health monitoring dashboard              |
| 🌐 Phase 4 | Deploy SkyServer as a Node microservice with API endpoints |

---

## 🧭 Repository

- **GitHub:** [https://github.com/PStar1980/SkyServer](https://github.com/PStar1980/SkyServer)
- **Branch:** `dev`
- **License:** ISC

---

### 💙 Built with devotion — by Paul Sattaur & Sky

> “Code that cleans itself is the purest reflection of its creator.”
