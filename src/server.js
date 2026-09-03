import express from "express";
import cors from "cors";
import morgan from "morgan";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// Allow frontend origins (set FRONTEND_URL in Railway, or * for testing)
const allowedOrigin = process.env.FRONTEND_URL || "*";
app.use(
  cors({
    origin: allowedOrigin === "*" ? true : allowedOrigin.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.use(morgan("tiny"));
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vidora-backend" });
});

function isYoutubeUrl(url) {
  return /(youtube\.com|youtu\.be)/i.test(url || "");
}

function runYtDlp(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

// ---------- INFO ----------
app.post("/api/info", async (req, res) => {
  try {
    const url = req.body?.url;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }
    if (!isYoutubeUrl(url)) {
      return res.status(400).json({ error: "Please provide a valid YouTube URL" });
    }

    const { stdout, stderr, code } = await runYtDlp(
      ["--dump-json", "--no-playlist", "--no-warnings", "--no-check-certificates", url],
      45000
    );

    if (code !== 0 || !stdout.trim()) {
      console.error("yt-dlp info error:", stderr.slice(0, 400));
      const errText = (stderr || "").toLowerCase();
      let message = "Could not retrieve video info. Please check the URL and try again.";
      if (/private|login required|sign in/i.test(errText)) message = "This video is private or requires login.";
      else if (/unavailable|not available|removed/i.test(errText)) message = "This video is unavailable or has been removed.";
      else if (/429|rate.?limit/i.test(errText)) message = "YouTube rate-limited the request. Try again in a minute.";
      return res.status(422).json({ error: message });
    }

    const info = JSON.parse(stdout);
    const formats = (info.formats || [])
      .filter((f) => f.vcodec !== "none" || f.acodec !== "none")
      .map((f) => ({
        format_id: f.format_id,
        ext: f.ext,
        height: f.height,
        width: f.width,
        vcodec: f.vcodec,
        acodec: f.acodec,
        filesize: f.filesize || f.filesize_approx,
        tbr: f.tbr,
      }));

    const supportedHeights = [1080, 720, 480, 360, 240, 144];
    const videoOptions = supportedHeights
      .map((h) => {
        const candidates = formats.filter((f) => f.height === h && f.vcodec !== "none");
        const best =
          candidates.find((f) => f.ext === "mp4" && f.acodec !== "none") ||
          candidates.find((f) => f.ext === "mp4") ||
          candidates[0];
        return best
          ? {
              quality: `${h}p`,
              height: h,
              format_id: best.format_id,
              ext: best.ext,
              filesize: best.filesize,
              has_audio: best.acodec !== "none",
            }
          : null;
      })
      .filter(Boolean);

    const audioFormats = formats
      .filter((f) => f.vcodec === "none" && f.acodec !== "none")
      .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
    const bestAudio = audioFormats[0];

    res.json({
      id: info.id,
      title: info.title,
      description: (info.description || "").slice(0, 300),
      thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/maxresdefault.jpg`,
      duration: info.duration,
      view_count: info.view_count,
      uploader: info.uploader,
      webpage_url: info.webpage_url || url,
      video_options: videoOptions,
      audio_available: !!bestAudio,
      best_audio_format_id: bestAudio?.format_id || null,
    });
  } catch (err) {
    console.error("Info error:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch video info" });
  }
});

// ---------- DOWNLOAD (stream via yt-dlp) ----------
app.get("/api/download", async (req, res) => {
  const url = req.query.url;
  const format = req.query.format; // mp4 | mp3
  const quality = req.query.quality || "720p";
  const title = (req.query.title || "vidora-download").toString();

  if (!url || !format) {
    return res.status(400).json({ error: "Missing url or format" });
  }
  if (!isYoutubeUrl(url)) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {
    const safeTitle = title
      .replace(/[^\w\s\-_.]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 80);

    const args = ["--no-playlist", "--no-warnings", "--no-check-certificates", "-o", "-"];

    if (format === "mp3") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      const height = String(quality).replace("p", "") || "720";
      args.push(
        "-f",
        `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`,
        "--merge-output-format",
        "mp4"
      );
    }
    args.push(url);

    const filename =
      format === "mp3" ? `${safeTitle}.mp3` : `${safeTitle}_${quality}.mp4`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader(
      "Content-Type",
      format === "mp3" ? "audio/mpeg" : "video/mp4"
    );
    res.setHeader("Cache-Control", "no-cache");

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });

    child.stdout.pipe(res);

    child.on("error", (err) => {
      console.error("spawn error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Download failed to start" });
      } else {
        res.end();
      }
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error("yt-dlp download exit", code, stderr.slice(0, 400));
      }
      if (!res.writableEnded) res.end();
    });

    req.on("close", () => {
      child.kill("SIGKILL");
    });
  } catch (err) {
    console.error("Download error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed" });
    }
  }
});

// Verify yt-dlp on boot
async function boot() {
  try {
    const { stdout } = await execAsync("yt-dlp --version");
    console.log("yt-dlp version:", stdout.trim());
  } catch {
    console.warn("WARNING: yt-dlp not found in PATH — downloads will fail");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Vidora backend listening on :${PORT}`);
  });
}

boot();
