const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3005);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const STORAGE_DIR =
  process.env.STORAGE_DIR ||
  path.join(__dirname, "news_sessions");

const SESSION_TTL_HOURS = Math.max(
  1,
  Number(process.env.SESSION_TTL_HOURS || 24)
);

const MAX_UPLOAD_MB = Math.max(
  10,
  Number(process.env.MAX_UPLOAD_MB || 100)
);

fs.mkdirSync(STORAGE_DIR, { recursive: true });

function publicBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;

  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : req.protocol;

  return `${protocol}://${req.get("host")}`;
}

function newSessionId() {
  return `S_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function validSessionId(value) {
  return /^S_[0-9]+_[a-z0-9]+$/i.test(String(value || ""));
}

function makeSessionDir(req) {
  const sessionId = req.sessionId || newSessionId();
  req.sessionId = sessionId;

  const dir = path.join(STORAGE_DIR, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      cb(null, makeSessionDir(req));
    } catch (error) {
      cb(error);
    }
  },

  filename: (req, file, cb) => {
    const originalExt = path.extname(file.originalname).toLowerCase();
    const ext =
      originalExt ||
      (file.fieldname === "video" ? ".mp4" : ".png");

    cb(
      null,
      file.fieldname === "video"
        ? `video${ext}`
        : `photo${ext}`
    );
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "image") {
      if (!file.mimetype.startsWith("image/")) {
        return cb(new Error("File image không hợp lệ."));
      }
      return cb(null, true);
    }

    if (file.fieldname === "video") {
      if (!file.mimetype.startsWith("video/")) {
        return cb(new Error("File video không hợp lệ."));
      }
      return cb(null, true);
    }

    return cb(new Error("Trường upload không hợp lệ."));
  }
});

app.disable("x-powered-by");

app.use(
  "/files",
  express.static(STORAGE_DIR, {
    fallthrough: true,
    etag: true,
    maxAge: "1h"
  })
);

app.get("/", (_, res) => {
  res.json({
    success: true,
    service: "Photobooth Media/QR Server",
    version: "4.0.0-online",
    status: "running"
  });
});

app.get("/health", (_, res) => {
  res.json({
    success: true,
    service: "Photobooth Media/QR Server",
    version: "4.0.0-online",
    status: "running",
    storageDir: STORAGE_DIR,
    sessionTtlHours: SESSION_TTL_HOURS
  });
});

async function buildSession(
  req,
  res,
  imageFile,
  videoFile,
  legacy = false
) {
  try {
    if (!imageFile) {
      return res.status(400).json({
        success: false,
        error: "Không nhận được file image."
      });
    }

    const sessionId = req.sessionId;

    if (!validSessionId(sessionId)) {
      return res.status(500).json({
        success: false,
        error: "Session ID không hợp lệ."
      });
    }

    const sessionDir =
      path.join(STORAGE_DIR, sessionId);

    const baseUrl =
      publicBaseUrl(req);

    const sessionUrl =
      `${baseUrl}/s/${sessionId}`;

    const qrSize = Math.max(
      90,
      Math.min(
        400,
        Number(req.body?.qrSize) || 165
      )
    );

    const qrMargin = Math.max(
      0,
      Math.min(
        150,
        Number(req.body?.qrMargin) || 28
      )
    );

    const qrDataUrl =
      await QRCode.toDataURL(
        sessionUrl,
        {
          width: 700,
          margin: 2,
          errorCorrectionLevel: "M"
        }
      );

    const qrBuffer =
      await QRCode.toBuffer(
        sessionUrl,
        {
          width: qrSize,
          margin: 2,
          errorCorrectionLevel: "M"
        }
      );

    const meta =
      await sharp(imageFile.path).metadata();

    const left = Math.max(
      0,
      (meta.width || 1000) -
        qrSize -
        qrMargin
    );

    const top = Math.max(
      0,
      (meta.height || 1400) -
        qrSize -
        qrMargin
    );

    const printFilename =
      "print_with_qr.png";

    const printPath =
      path.join(
        sessionDir,
        printFilename
      );

    await sharp(imageFile.path)
      .composite([
        {
          input: qrBuffer,
          left,
          top
        }
      ])
      .png()
      .toFile(printPath);

    const imageUrl =
      `${baseUrl}/files/${sessionId}/${encodeURIComponent(
        path.basename(imageFile.path)
      )}`;

    const printImageUrl =
      `${baseUrl}/files/${sessionId}/${printFilename}`;

    const videoUrl =
      videoFile
        ? `${baseUrl}/files/${sessionId}/${encodeURIComponent(
            path.basename(videoFile.path)
          )}`
        : null;

    const expiresAt =
      new Date(
        Date.now() +
          SESSION_TTL_HOURS *
            60 *
            60 *
            1000
      ).toISOString();

    const data = {
      sessionId,
      sessionUrl,
      imageUrl,
      printImageUrl,
      videoUrl,
      createdAt: new Date().toISOString(),
      expiresAt
    };

    fs.writeFileSync(
      path.join(
        sessionDir,
        "session.json"
      ),
      JSON.stringify(
        data,
        null,
        2
      ),
      "utf8"
    );

    if (legacy) {
      return res.json({
        success: true,
        downloadUrl: sessionUrl,
        printImageUrl,
        qrDataUrl,
        expiresAt
      });
    }

    return res.json({
      success: true,
      sessionId,
      sessionUrl,
      imageUrl,
      printImageUrl,
      videoUrl,
      qrDataUrl,
      hasVideo: Boolean(videoUrl),
      expiresAt
    });
  } catch (error) {
    console.error(
      "[BUILD SESSION ERROR]",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

app.post(
  "/api/news/session",
  upload.fields([
    {
      name: "image",
      maxCount: 1
    },
    {
      name: "video",
      maxCount: 1
    }
  ]),
  async (req, res) => {
    await buildSession(
      req,
      res,
      req.files?.image?.[0],
      req.files?.video?.[0],
      false
    );
  }
);

app.post(
  "/api/news/upload",
  upload.single("image"),
  async (req, res) => {
    await buildSession(
      req,
      res,
      req.file,
      null,
      true
    );
  }
);

app.get(
  "/s/:sessionId",
  (req, res) => {
    try {
      const sessionId =
        req.params.sessionId;

      if (!validSessionId(sessionId)) {
        return res
          .status(404)
          .send("Phiên ảnh không tồn tại.");
      }

      const sessionDir =
        path.join(
          STORAGE_DIR,
          sessionId
        );

      const jsonPath =
        path.join(
          sessionDir,
          "session.json"
        );

      if (!fs.existsSync(jsonPath)) {
        return res
          .status(404)
          .send("Phiên ảnh không tồn tại hoặc đã hết hạn.");
      }

      const data =
        JSON.parse(
          fs.readFileSync(
            jsonPath,
            "utf8"
          )
        );

      const videoHtml =
        data.videoUrl
          ? `
<section class="card">
  <h2>Video ngắn</h2>
  <video controls playsinline preload="metadata">
    <source src="${data.videoUrl}" type="video/mp4">
  </video>
  <a class="btn" href="${data.videoUrl}" download>Tải video</a>
</section>`
          : `
<section class="card">
  <h2>Video ngắn</h2>
  <p>Phiên này chưa có video.</p>
</section>`;

      res.send(`
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tờ báo của bạn</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Arial,sans-serif;
  background:#efe8dc;
  color:#201a15
}
.wrap{
  max-width:760px;
  margin:auto;
  padding:18px
}
h1{
  text-align:center;
  font-family:Georgia,serif
}
.card{
  background:white;
  padding:16px;
  margin:16px 0;
  border-radius:16px;
  box-shadow:0 4px 18px rgba(0,0,0,.08)
}
img,video{
  width:100%;
  height:auto;
  display:block;
  border-radius:10px
}
.btn{
  display:block;
  padding:15px 18px;
  margin-top:12px;
  background:#111;
  color:white;
  text-decoration:none;
  text-align:center;
  border-radius:10px;
  font-weight:bold
}
.note{
  text-align:center;
  opacity:.72
}
</style>
</head>
<body>
<div class="wrap">
  <h1>TỜ BÁO CỦA RIÊNG BẠN</h1>

  <section class="card">
    <h2>Ảnh điện tử</h2>
    <img src="${data.imageUrl}" alt="Ảnh tờ báo">
    <a class="btn" href="${data.imageUrl}" download>Tải ảnh</a>
  </section>

  ${videoHtml}

  <p class="note">
    Ảnh và video hết hạn sau ${SESSION_TTL_HOURS} giờ.
  </p>
  <p class="note">PhotoboothNews</p>
</div>
</body>
</html>`);
    } catch (error) {
      console.error(
        "[SESSION PAGE ERROR]",
        error
      );

      res
        .status(500)
        .send("Không thể mở phiên ảnh.");
    }
  }
);

function cleanupExpiredSessions() {
  const cutoff =
    Date.now() -
    SESSION_TTL_HOURS *
      60 *
      60 *
      1000;

  try {
    for (const name of fs.readdirSync(STORAGE_DIR)) {
      const dir =
        path.join(
          STORAGE_DIR,
          name
        );

      let stat;

      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) {
        continue;
      }

      if (stat.mtimeMs < cutoff) {
        try {
          fs.rmSync(
            dir,
            {
              recursive: true,
              force: true
            }
          );

          console.log(
            "[CLEANUP] Removed:",
            name
          );
        } catch (error) {
          console.error(
            "[CLEANUP ERROR]",
            name,
            error.message
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "[CLEANUP SCAN ERROR]",
      error.message
    );
  }
}

cleanupExpiredSessions();

setInterval(
  cleanupExpiredSessions,
  60 * 60 * 1000
).unref();

app.use(
  (error, req, res, next) => {
    console.error(
      "[REQUEST ERROR]",
      error
    );

    res.status(400).json({
      success: false,
      error:
        error.message ||
        "Yêu cầu không hợp lệ."
    });
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "=============================================="
    );
    console.log(
      " Photobooth Media/QR Server ONLINE"
    );
    console.log(
      ` Port: ${PORT}`
    );
    console.log(
      ` Storage: ${STORAGE_DIR}`
    );
    console.log(
      ` TTL: ${SESSION_TTL_HOURS} hours`
    );
    console.log(
      ` Public URL: ${
        PUBLIC_BASE_URL ||
        "(auto from request host)"
      }`
    );
    console.log(
      "=============================================="
    );
    console.log("");
  }
);
