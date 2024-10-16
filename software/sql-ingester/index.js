import express from "express"
import sqlite from "sqlite3"
import { FSAdapter } from "dlflib-js/dist/fsadapter.js";
import { fstat, readdirSync, rmSync, rmdirSync } from "fs"
import { readFile } from "fs/promises"
import multer from "multer";
import { resolve } from "path";
import { mkdirSync } from "fs";
import { Sequelize, DataTypes } from 'sequelize';

const UPLOAD_DIR = "uploads"

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const p = resolve(UPLOAD_DIR, req.params.id);
        mkdirSync(p, { recursive: true });

        cb(null, p)
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname)
    }
});

const upload = multer({ storage })
const app = express();


let ingestTout = null;
app.post("/upload/:id", upload.any('files', 3), async (req, res) => {
    console.log(req.files)
    res.send("OK!");

    try {
        await ingestRun(req.params.id);
    } catch (e) {
        console.log(`FAILED TO INGEST ${req.params.id}`);
        console.error(e);
    }
});


const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: 'db.sqlite',
    logging: false
});

const Run = sequelize.define('Run', {
    uuid: DataTypes.STRING,
    metadata: DataTypes.JSON,
});

const RunData = sequelize.define('RunData', {
    type: DataTypes.ENUM("polled", "event"),
    stream_id: DataTypes.STRING,
    tick: DataTypes.BIGINT,
    data: DataTypes.STRING,
});

// Run.hasMany(RunData);
RunData.belongsTo(Run);

async function ingestRun(runUUID) {
    ingestTout = null
    const already_ingested = await Run.count({
        where: {
            uuid: runUUID
        }
    });

    if (already_ingested > 0)
        return

    console.log("Creating run!");

    const r = await Run.create({
        uuid: runUUID,
        metadata: {}
    });

    console.log("Ingesting event data");

    const run = new FSAdapter(resolve(UPLOAD_DIR, runUUID));

    let dat = await run.events_data()
    let bulkData = dat.map((d) => {
        const dataStr = typeof d.data == "object" ? JSON.stringify(d.data) : d.data.toString();
        return {
            type: "event",
            stream_id: d.stream.id,
            tick: d.tick,
            data: dataStr,
            RunId: r.id
        };
    })
    await RunData.bulkCreate(bulkData);


    dat = await run.polled_data()
    bulkData = dat.map((d) => {
        const dataStr = typeof d.data == "object" ? JSON.stringify(d.data) : d.data.toString();
        return {
            type: "polled",
            stream_id: d.stream.id,
            tick: d.tick,
            data: dataStr,
            RunId: r.id
        };
    });
    await RunData.bulkCreate(bulkData);


    // sync
    await RunData.sync();
}

// rmSync(UPLOAD_DIR, {recursive: true, force: true});
// mkdirSync(UPLOAD_DIR);

app.listen(8080, () => {
    console.log("Listening");
});

(async () => {
    await sequelize.sync({ force: true });
    console.log("DONE");
})();
