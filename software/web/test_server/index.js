const express = require("express");
const ct = require("c-type-util");
const app = express();
app.use(express.static("./public"));

let c = 0;
app.get("/__LIVE", (req, res) => {
    res.send(Buffer.from(ct.cStruct({
        time: ct.uint32,
        data0: ct.uint8,
        data1: ct.uint8,
        sin_waves: ct.cStruct({
            s5: ct.float,
            s10: ct.float,
            s1: ct.float
        }),
        d_random: ct.uint16
    }).allocLE({
        time: c++,
        data0: 10,
        data1: 100,
        sin_waves: {
            s1: Math.sin(c),
            s10: 22,
            s5: 5
        },
        d_random: Math.random() * 300
    })));
});

app.listen(3000);