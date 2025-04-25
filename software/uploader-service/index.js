import { FSAdapter } from "dlflib-js/dist/fsadapter.js";
import express from "express";
import { mkdirSync, rmSync } from "fs";
import multer from "multer";
import { resolve } from "path";
import { DataTypes, Sequelize } from "sequelize";

const PORT = 8080;
const UPLOAD_DIR = "uploads";

function getRunUploadDir(runUUID) {
  return resolve(UPLOAD_DIR, runUUID);
}

const app = express();

// Multer
const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    const runUploadDir = getRunUploadDir(req.params.id);
    mkdirSync(runUploadDir, { recursive: true });

    callback(null, runUploadDir);
  },
  filename: (req, file, callback) => {
    callback(null, file.originalname);
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
  epoch_time_s: DataTypes.INTEGER,
  tick_base_us: DataTypes.INTEGER,
  metadata: DataTypes.JSON,
});
const RunData = sequelize.define("RunData", {
  stream_type: DataTypes.ENUM("polled", "event"),
  stream_id: DataTypes.STRING,
  tick: DataTypes.BIGINT,
  data: DataTypes.STRING,
});
RunData.belongsTo(Run);
Run.hasMany(RunData);

// Each run is associated with 3 files (meta.dlf, event.dlf, polled.dlf)
app.post("/upload/:id", upload.array("files", 3), async (req, res) => {
  const runUUID = req.params.id;
  console.log(`Received files for run ${runUUID}:`);
  console.log(req.files);

  // Check that expected files are present
  const allowedFilenames = new Set(["meta.dlf", "event.dlf", "polled.dlf"]);
  for (const file of req.files) {
    if (!allowedFilenames.has(file.originalname)) {
      return res
        .status(400)
        .json({ error: `Invalid file: ${file.originalname}` });
    }
  }

  try {
    await ingestRun(runUUID);
    res.status(200).json({ message: "Upload successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  } finally {
    // Clean upload directory after processing
    try {
      rmSync(getRunUploadDir(runUUID), {
        recursive: true,
        force: true,
      });
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
  const run = new FSAdapter(getRunUploadDir(runUUID));

  const metaHeader = await run.meta_header();
  const runInstance = await Run.create({
    uuid: runUUID,
    epoch_time_s: metaHeader.epoch_time_s,
    tick_base_us: metaHeader.tick_base_us,
    metadata: {},
  });

  const eventsData = await run.events_data();
  await RunData.bulkCreate(
    eventsData.map((d) => {
      return {
        stream_type: "event",
        stream_id: d.stream.id,
        tick: d.tick,
        data:
          typeof d.data == "object"
            ? JSON.stringify(d.data)
            : d.data.toString(),
        RunId: runInstance.id,
      };
    })
  );
  console.log("Ingested event data");

  const polledData = await run.polled_data();
  await RunData.bulkCreate(
    polledData.map((d) => {
      return {
        stream_type: "polled",
        stream_id: d.stream.id,
        tick: d.tick,
        data:
          typeof d.data == "object"
            ? JSON.stringify(d.data)
            : d.data.toString(),
        RunId: runInstance.id,
      };
    })
  );
  console.log("Ingested polled data");
}

// List all runs
app.get("/api/runs", async (req, res) => {
  try {
    const runs = await Run.findAll({
      attributes: ["uuid", "epoch_time_s"],
    });
    res.json(runs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch runs" });
  }
});

// Get metadata for a single run + stream_ids
app.get("/api/runs/:uuid", async (req, res) => {
  try {
    const run = await Run.findOne({
      where: { uuid: req.params.uuid },
    });

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const streams = await RunData.findAll({
      where: { RunId: run.id },
      attributes: [
        [Sequelize.fn("DISTINCT", Sequelize.col("stream_id")), "stream_id"],
        "stream_type",
        [Sequelize.fn("COUNT", Sequelize.col("stream_id")), "count"],
      ],
      group: ["stream_id", "stream_type"],
      raw: true,
    });

    const streamData = streams.map((stream) => ({
      stream_id: stream.stream_id,
      stream_type: stream.stream_type,
      count: parseInt(stream.count, 10),
    }));

    const runData = Object.keys(run.toJSON()).reduce((result, key) => {
      if (["uuid", "epoch_time_s", "tick_base_us", "metadata"].includes(key)) {
        result[key] = run[key];
      }
      return result;
    }, {});

    res.json({
      ...runData,
      streams: streamData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch run data" });
  }
});

// Get stream data for multiple stream_ids
app.get("/api/runs/:uuid/streams", async (req, res) => {
  const { uuid } = req.params;
  const { stream_ids } = req.query;

  // Validate that the stream_ids parameter exists
  if (!stream_ids) {
    return res
      .status(400)
      .json({ error: "stream_ids query parameter is required" });
  }

  const streamIdsArray = stream_ids.split(",");

  try {
    const run = await Run.findOne({
      where: { uuid },
      include: {
        model: RunData,
        where: {
          stream_id: {
            [Sequelize.Op.in]: streamIdsArray,
          },
        },
        attributes: ["stream_id", "tick", "data"],
        order: [["tick", "ASC"]],
      },
    });

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const runData = run.RunData.map((data) => ({
      stream_id: data.stream_id,
      tick: data.tick,
      data: data.data,
    }));

    res.json(runData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch streams" });
  }
});

// Get stream data for a single stream_id
app.get("/api/runs/:uuid/streams/:stream_id", async (req, res) => {
  try {
    const run = await Run.findOne({
      where: { uuid: req.params.uuid },
      attributes: ["id"],
    });

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
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
    res.status(500).json({ error: "Error retrieving run data" });
  }
});

app.listen(PORT, () => {
  console.log("Upload server listening");
});

(async () => {
  await sequelize.sync(); // note: use { force: true } to drop all tables and recreate them
  console.log("DB initialized");
})();
