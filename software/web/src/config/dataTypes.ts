import { cStruct, float, uint16, uint8 } from "c-type-util";

export default {
    "unsigned char": uint8,
    "sin_waves_t": cStruct({
        s5: float,
        s10: float,
        s1: float,
    }),
    "short unsigned int": uint16,
}