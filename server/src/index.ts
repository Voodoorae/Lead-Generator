import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import leadsRouter from "./routes/leads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api", leadsRouter);

// Serve built React frontend
const distPath = path.join(__dirname, "../../client/dist");
app.use(express.static(distPath));

// SPA fallback — all non-API routes serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`✓ LocalGrid server running on port ${port}`);
  console.log(`  Google Places key: ${process.env.GOOGLE_PLACES_API_KEY ? "✓ set" : "✗ MISSING"}`);
});
