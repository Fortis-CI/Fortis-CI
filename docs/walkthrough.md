# Fortis-CI Local Demo Setup Guide

Here is a step-by-step guide to run a full local demo of Fortis-CI for your expo tomorrow. I have also added a data seeding script to automatically populate your dashboard with realistic data (deployments, files, errors, and health statuses) so you don't have to present an empty dashboard.

> [!TIP]
> Run these commands on your local machine to prepare for the expo.

## 1. Start the Database and Cache

Instead of running the full `docker-compose up -d` (which builds the app containers), we will only run Neo4j and Redis. This allows you to run the frontend and backend directly via Node.js so you can easily show the code and logs.

In your terminal, run:

```bash
cd /path/to/Fortis-CI
docker compose up -d neo4j redis
```

> [!NOTE]
> Wait about 10-15 seconds for Neo4j to be fully ready before proceeding to the next step.

## 2. Start the Backend & Seed Demo Data

Open a new terminal window for the backend:

```bash
cd /path/to/Fortis-CI/backend

# Install dependencies if you haven't already
npm install

# Apply the Neo4j schema constraints
npm run schema

# Insert rich demo data (Services, Commits, Deployments, and Errors)
npm run seed

# Start the backend API
npm run dev
```

> [!IMPORTANT]
> Keep this terminal running during your presentation. It will log incoming webhooks and health check polling, which looks great for demos.

## 3. Start the Frontend Dashboard

Open a third terminal window for the frontend:

```bash
cd /path/to/Fortis-CI/frontend

# Install dependencies
npm install

# Start the Next.js development server
npm run dev
```

## 4. Presenting the Demo

Once everything is running, open your browser to **http://localhost:3000**. 

You will see:
- The dashboard automatically populates with 2 services, 3 recent deployments, and error/health data.
- The `fortis-ci-backend` service will show a recent "failed deployment" and its subsequent "successful deployment" fix.
- You can navigate through the graph visualization to show how the `SyntaxError` maps to a specific `File` and `Commit`.

### Demo Narrative Tips

1. **Start at the Dashboard**: Show the high-level metrics. Point out how the system tracks "what's deployed and if it's healthy".
2. **Show the Failure**: Click into the failed backend deployment. Explain how Fortis-CI automatically ran a Root Cause Analysis.
3. **Show the Graph**: Highlight the Neo4j graph structure. Explain how "Deployment failures are a graph problem" and show the exact traversal from the error down to the file and commit that caused it.
4. **Show the Backend Logs**: Bring up your terminal running the backend to show the real-time polling happening in the background.

Good luck with your expo! Let me know if you need any adjustments to the dummy data or if anything else is missing.
