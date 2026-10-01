import path from "path";
import cors from "cors";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import deviceRoutes from "./routes/device.routes";
import historyRoutes from "./routes/history.routes";
import statisticsRoutes from "./routes/statistics.routes";
import telemetryRoutes from "./routes/telemetry.routes";
import userRoutes from "./routes/user.routes";
import { errorHandler, notFoundMiddleware } from "./utils/error.middleware";

export function createApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: null,
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          imgSrc: [
            "'self'",
            "data:",
            "https://cdnjs.cloudflare.com",
            "https://*.tile.opentopomap.org",
            "https://server.arcgisonline.com",
            "https://services.arcgisonline.com",
            "https://*.basemaps.cartocdn.com"
          ],
          connectSrc: ["'self'", "https://nominatim.openstreetmap.org", "https://*.basemaps.cartocdn.com"],
          fontSrc: ["'self'", "data:"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(
    cors({
      origin: function (origin, callback) {
        const allowed = (process.env.ALLOWED_ORIGINS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (!origin || allowed.length === 0 || allowed.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    })
  );
  app.use(
    compression({
      level: 6,
      threshold: 1024
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use("/public", express.static(path.join(__dirname, "public")));

  app.get("/", (_req, res) => {
    res.redirect("/dashboard");
  });

  app.get("/login", (_req, res) => {
    res.render("login");
  });

  app.get("/dashboard", (_req, res) => {
    res.render("dashboard", {
      cartoApiKey: process.env.CARTO_API_KEY || ""
    });
  });

  app.use("/api", userRoutes);
  app.use("/api", deviceRoutes);
  app.use("/api", historyRoutes);
  app.use("/api", statisticsRoutes);
  app.use("/api", telemetryRoutes);

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
