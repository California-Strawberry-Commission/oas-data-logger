import { FSAdapter } from "dlflib-js/dist/fsadapter.js";
import express from "express";
import { mkdirSync, rmSync } from "fs";
import multer from "multer";
import { resolve } from "path";
import { DataTypes, Sequelize } from "sequelize";

const PORT = 8080;
const UPLOAD_DIR = "uploads";

const app = express();

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const p = resolve(UPLOAD_DIR, req.params.id);
    mkdirSync(p, { recursive: true });

    cb(null, p);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// Sequelize
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: "db.sqlite",
  logging: false,
});
const Run = sequelize.define("Run", {
  uuid: DataTypes.STRING,
  metadata: DataTypes.JSON,
});
const RunData = sequelize.define("RunData", {
  type: DataTypes.ENUM("polled", "event"),
  stream_id: DataTypes.STRING,
  tick: DataTypes.BIGINT,
  data: DataTypes.STRING,
});
RunData.belongsTo(Run);
Run.hasMany(RunData);

// Each run is associated with 3 files (meta.dlf, event.dlf, polled.dlf)
app.post("/upload/:id", upload.array("files", 3), async (req, res) => {
  console.log(`Received files for run ${req.params.id}:`);
  console.log(req.files);

  if (req.files.length !== 3) {
    return res.status(400).send("Exactly 3 files required.");
  }

  // Check that expected files are present
  const expectedFilenames = new Set(["meta.dlf", "event.dlf", "polled.dlf"]);
  // Count file occurrences
  const seen = new Map();
  for (const file of req.files) {
    const name = file.originalname;

    if (!expectedFilenames.has(name)) {
      return res.status(400).send(`Invalid file: ${name}`);
    }

    seen.set(name, (seen.get(name) || 0) + 1);
  }

  // Check that each expected file is present exactly once
  for (const name of expectedFilenames) {
    if (seen.get(name) !== 1) {
      return res.status(400).send(`Missing or duplicate file: ${name}`);
    }
  }

  try {
    await ingestRun(req.params.id);
    res.send("Upload successful.");
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Upload failed.");
  } finally {
    // Clean upload directory after processing
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch {}
  }
});

async function ingestRun(runUUID) {
  const alreadyIngested = await Run.count({
    where: {
      uuid: runUUID,
    },
  });

  if (alreadyIngested > 0) {
    console.log("Run " + runUUID + " already ingested. Ignoring");
    return;
  }

  console.log("Ingesting run " + runUUID);
  const run = new FSAdapter(resolve(UPLOAD_DIR, runUUID));

  const r = await Run.create({
    uuid: runUUID,
    metadata: {},
  });

  let dat = await run.events_data();
  let bulkData = dat.map((d) => {
    const dataStr =
      typeof d.data == "object" ? JSON.stringify(d.data) : d.data.toString();
    return {
      type: "event",
      stream_id: d.stream.id,
      tick: d.tick,
      data: dataStr,
      RunId: r.id,
    };
  });
  await RunData.bulkCreate(bulkData);
  console.log("Ingested event data");

  dat = await run.polled_data();
  bulkData = dat.map((d) => {
    const dataStr =
      typeof d.data == "object" ? JSON.stringify(d.data) : d.data.toString();
    return {
      type: "polled",
      stream_id: d.stream.id,
      tick: d.tick,
      data: dataStr,
      RunId: r.id,
    };
  });
  await RunData.bulkCreate(bulkData);
  console.log("Ingested polled data");
}

// Get a run by uuid
app.get("/api/runs/:uuid", async (req, res) => {
  try {
    const run = await Run.findOne({
      where: { uuid: req.params.uuid },
      include: [
        {
          model: RunData,
          attributes: ["type", "stream_id", "tick", "data"],
        },
      ],
    });

    if (!run) {
      return res.status(404).send("Run not found");
    }

    res.json(run);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving run");
  }
});

// Get run data by stream_id
app.get("/api/runs/:uuid/streams/:stream_id", async (req, res) => {
  try {
    const run = await Run.findOne({
      where: { uuid: req.params.uuid },
      attributes: ["id"],
    });

    if (!run) {
      return res.status(404).send("Run not found");
    }

    const runData = await RunData.findAll({
      where: {
        runId: run.id,
        stream_id: req.params.stream_id,
      },
      attributes: ["tick", "data"],
      order: [["tick", "ASC"]],
    });

    res.json(runData);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving run data");
  }
});

app.listen(PORT, () => {
  console.log("Upload server listening");
});

(async () => {
  await sequelize.sync(); // note: use { force: true } to drop all tables and recreate them
  console.log("DB initialized");
})();
