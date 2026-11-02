# 🚀 Real-Time Collaborative Kanban Board

A multi-tenant, real-time collaborative Kanban board that enables teams to organize tasks, manage workflows, and collaborate across multiple organizations and workspaces.

The application provides task management, role-based access control, tenant-level data isolation, real-time synchronization, activity tracking, and conflict detection.

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Technology Stack](#-technology-stack)
- [System Architecture](#-system-architecture)
- [Multi-Tenant Architecture](#-multi-tenant-architecture)
- [Role-Based Access Control](#-role-based-access-control)
- [Real-Time Collaboration](#-real-time-collaboration)
- [Concurrency Handling](#-concurrency-handling)
- [Database Design](#-database-design)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Documentation](#-api-documentation)
- [Testing](#-testing)
- [Known Limitations](#-known-limitations)
- [Future Improvements](#-future-improvements)

---

## 📖 Overview

The Real-Time Collaborative Kanban Board is designed to help organizations manage projects and tasks through a structured visual workflow.

Unlike a basic Kanban application, this system supports multiple organizations, multiple tenants (teams or workspaces), and different permission levels.

Users can create boards, manage tasks, assign responsibilities, track progress, and collaborate with other team members in real time.

The application also includes mechanisms to prevent unauthorized cross-tenant access and detect conflicting updates when multiple users modify the same task.

## ✨ Key Features

### 🔐 Authentication and Authorization

- User registration and login.
- JWT-based authentication.
- Access and refresh token mechanism.
- Protected application routes.
- Role-based permissions.

### 🏢 Multi-Organization and Multi-Tenant Support

- Multiple organizations.
- Multiple teams or tenants within an organization.
- Organization and tenant selection.
- Tenant-specific boards and tasks.
- Tenant-level access restrictions.
- Protection against unauthorized cross-tenant access.

### 📋 Kanban Board Management

- Create and manage boards.
- Default workflow columns:
  - To Do
  - In Progress
  - Testing
  - Done
- Create, update, and delete tasks.
- Assign tasks to team members.
- Set task priorities.
- Add task descriptions.
- Drag-and-drop task movement.
- Search and filter tasks.

### ⚡ Real-Time Collaboration

- Live task synchronization.
- Real-time board updates.
- Online user presence indicators.
- Activity history.
- Updates reflected across connected browser sessions.
- Network recovery and board-state reconciliation.

### 🔄 Task Concurrency Management

- Task version tracking.
- Stale-update detection.
- Conflict notifications.
- Option to discard outdated changes or explicitly overwrite with the latest version.
- Operation ID support for request de-duplication.

### 📊 Activity Tracking

- Track task creation.
- Track task updates and assignments.
- Track task movement.
- Track task deletion.
- Maintain activity history for collaboration visibility.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React.js, Vite, JavaScript |
| Styling | Tailwind CSS |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| ORM | Prisma |
| Authentication | JWT, bcrypt |
| Real-Time Communication | Socket.IO |
| API Documentation | Swagger / OpenAPI |
| Testing | Vitest |
| Database Hosting | Neon PostgreSQL |
| Version Control | Git, GitHub |

---

## 🏗️ System Architecture

The application follows a client-server architecture.

```text
              ┌────────────────────────┐
              │      React Frontend    │
              │                        │
              │  Authentication        │
              │  Kanban Board          │
              │  Task Management       │
              │  Organization Selector │
              └───────────┬────────────┘
                          │
                REST API / Socket.IO
                          │
              ┌───────────▼────────────┐
              │   Node.js Backend     │
              │                       │
              │  Express.js           │
              │  Authentication       │
              │  Authorization        │
              │  Tenant Isolation     │
              │  Task Management      │
              │  Socket.IO Server     │
              └───────────┬───────────┘
                          │
                     Prisma ORM
                          │
              ┌───────────▼────────────┐
              │    PostgreSQL         │
              │                       │
              │  Organizations        │
              │  Tenants               │
              │  Users                 │
              │  Memberships           │
              │  Boards                │
              │  Columns               │
              │  Tasks                 │
              │  Activity Logs         │
              └───────────────────────┘
```

### Application Workflow

When a user moves a task:

1. The user performs a drag-and-drop action in the React interface.
2. The frontend sends the operation to the backend.
3. The backend authenticates the user.
4. Authorization and tenant membership are checked.
5. The backend validates the task version.
6. PostgreSQL is updated through Prisma.
7. An activity record is created.
8. Socket.IO broadcasts the update to authorized users in the relevant tenant.
9. Other connected clients update their interfaces.

---

## 🏢 Multi-Tenant Architecture

The application uses an organization-based multi-tenant structure.

```text
Organization
│
├── Tenant / Team A
│   ├── Members
│   ├── Board 1
│   └── Board 2
│
├── Tenant / Team B
│   ├── Members
│   └── Board 3
│
└── Tenant / Team C
    ├── Members
    └── Board 4
```

### How Isolation Works

- Organizations represent independent business entities.
- Tenants represent teams or workspaces within an organization.
- Memberships determine which users can access each tenant.
- Backend authorization checks control access to tenant-specific resources.
- Socket.IO communication is scoped to authorized tenant rooms.

The backend is responsible for enforcing access restrictions. Hiding a workspace in the frontend is not treated as a security boundary.

---

## 🔑 Role-Based Access Control

The application supports three primary roles.

| Role | Permissions |
|---|---|
| Organization Admin | Organization-level administration and access to its tenants |
| Tenant Admin | Manage the assigned tenant, boards, and memberships |
| Member | Access assigned tenant boards and collaborate on tasks |

Permissions are enforced through backend authorization rather than relying only on frontend visibility.

---

## ⚡ Real-Time Collaboration

Socket.IO is used for bidirectional communication between the backend and connected clients.

The application supports:

- Task creation and updates.
- Task movement and deletion.
- Board and column updates.
- Activity notifications.
- Online/offline presence.
- Tenant-scoped event delivery.
- Reconnection and state reconciliation.

Tenant-scoped communication helps ensure that users receive updates only from workspaces they are authorized to access.

---

## 🔄 Concurrency Handling

Multiple users may update the same task simultaneously.

To handle this situation, the application uses task versioning and stale-update detection.

### Example

1. User A loads a task at version 1.
2. User B loads the same task at version 1.
3. User A updates the task, resulting in version 2.
4. User B attempts to save an update using version 1.
5. The backend detects that the submitted version is outdated.
6. The application returns a conflict response rather than silently overwriting the latest data.

The interface provides options to discard the outdated edit or explicitly overwrite using the latest version.

---

## 🗄️ Database Design

PostgreSQL is used as the primary relational database, with Prisma as the ORM.

The database design covers the following core entities:

| Entity | Responsibility |
|---|---|
| Organizations | Stores organization information |
| Tenants | Stores teams or workspaces |
| Users | Stores user accounts |
| Memberships | Connects users to tenants and roles |
| Boards | Stores Kanban boards |
| Columns | Stores board workflow columns |
| Tasks | Stores task information and versions |
| Activity Logs | Records user actions |

Prisma handles database access, relationships, and database operations.

---

## 📁 Project Structure

```text
collaborative-kanban/
│
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── tests/
│   ├── src/
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   └── utils/
│   ├── package.json
│   └── .env.example
│
├── screenshots/
│
├── docs/
│
├── .gitignore
└── README.md
```

*The structure above describes the main project areas; individual source files may vary.*

---

## ⚙️ Getting Started

### Prerequisites

Install the following:

- Node.js
- npm
- Git
- PostgreSQL database (local or hosted through Neon)

### 1. Clone the Repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd collaborative-kanban
```

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the backend directory and configure the required environment variables.

Generate the Prisma Client:

```bash
npm run db:generate
```

Apply the database SQL setup:

```bash
npm run db:apply-sql
```

Seed the database:

```bash
npm run db:seed
```

Start the backend:

```bash
npm run dev
```

### 3. Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite will display the local frontend URL in the terminal. Open that URL in your browser.

### 4. API Documentation

When the backend is running, open:

```text
http://localhost:5000/api/docs
```

The Swagger interface provides access to the available API documentation.

---

## 🔐 Environment Variables

Create environment files locally. Never commit actual credentials or secrets.

### Backend (`backend/.env`)

Configure the variables required by the backend:

```env
DATABASE_URL="your_neon_postgresql_connection_string"

JWT_ACCESS_SECRET="your_access_token_secret"
JWT_REFRESH_SECRET="your_refresh_token_secret"
```

Add any other variables required by the backend's configuration.

### Frontend (`frontend/.env`)

Configure the frontend API and Socket.IO URLs using the variable names expected by the frontend source code.

Example values:

```env
VITE_API_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

Check the actual frontend configuration before using these example variable names.

---

## 📚 API Documentation

The backend provides REST APIs for application operations, including:

- Authentication.
- Organization management.
- Tenant management.
- Membership management.
- Board management.
- Column management.
- Task management.
- Activity history.

Interactive API documentation is available through Swagger:

`http://localhost:5000/api/docs`

---

## 🧪 Testing

Automated tests were executed using Vitest.

### Frontend Test Results

| Test File | Tests Passed |
|---|---:|
| Components | 9 |
| Board Hooks | 7 |
| Authentication Pages | 4 |
| Board Utilities | 9 |
| **Total** | **29 / 29** |

**Frontend production build:** Successful.

```bash
cd frontend
npm test
npm run build
```

### Backend Test Results

The backend test suite was executed against the configured PostgreSQL database.

| Result | Count |
|---|---:|
| Passed | 49 |
| Failed | 10 |
| Unhandled errors | 5 |

Some backend tests involving task ordering, concurrent task creation, tenant administration, and Socket.IO event delivery require further investigation.

Prisma Client generation completed successfully.

```bash
cd backend
npm test
npm run db:generate
```

### Manual Verification

The following workflows were manually exercised through the application interface:

- User authentication.
- Board and task management.
- Drag-and-drop task movement.
- Task editing and deletion.
- Activity history.
- Undo and redo.
- Two-session real-time synchronization.
- Concurrent editing conflict notification.
- Tenant visibility and access restrictions.
- Search and filtering.
- Network recovery.

Manual UI verification is not a substitute for a complete automated security or integration test suite.

---

## ⚠️ Known Limitations

- Some backend automated tests currently fail and require additional debugging.
- Concurrent database operations and Socket.IO event delivery need further automated verification.
- The project has been tested locally; a public production deployment is not currently provided.

---

## 🔮 Future Improvements

- Resolve remaining backend integration and concurrency test failures.
- Add comprehensive API and WebSocket integration tests.
- Improve database transaction handling under high concurrency.
- Add automated end-to-end testing.
- Add notifications and advanced task filtering.
- Improve production monitoring and logging.
- Deploy the application with production-grade infrastructure.

---

## 👨‍💻 Author

**Omprakash Karri**

B.Tech – Computer Science and Engineering (Data Science)

GitHub: [OMPRAKASHKARRI](https://github.com/OMPRAKASHKARRI)

---

## 📄 License

This project was developed as a collaborative Kanban board assignment.

