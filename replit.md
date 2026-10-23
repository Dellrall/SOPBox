# Replit setup

## Run the app

Use the **Start application** workflow. It installs the locked frontend dependencies, builds the React app, installs the FastAPI requirements, and serves the app on port 5000 for the Replit preview.

The app connects to the Replit PostgreSQL database through `DATABASE_URL` and creates its tables and workspace-isolation policies at startup. Open the preview and choose **Create a workspace** to create the first owner account.

The API health check is available at `/api/health`.

## Optional integrations

- Order-photo reading requires `RUNPOD_ENDPOINT_ID` and `RUNPOD_API_KEY` in Replit Secrets. Without them, staff can enter delivery lines manually.
- Telegram alerts require `TELEGRAM_BOT_TOKEN`; workspace chat IDs are configured in the app's Settings.
