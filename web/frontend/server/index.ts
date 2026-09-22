import { serve } from "@hono/node-server";
import { app } from './app.js';

const port = parseInt(process.env.PORT || "5000");
console.log(`Server running on port ${port}`);
serve({ fetch: app.fetch, port });
