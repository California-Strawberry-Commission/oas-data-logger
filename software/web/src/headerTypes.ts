import { cString, cStruct, float, uint32 } from "c-type-util";

export const header_t = cStruct({
    header_version: uint32,
    cycle_time_base_ms: uint32,
    num_cycles: uint32,
    start_time_epoch: uint32,
    run_location: cStruct({
        longitude: float,
        latitude: float,
    }),
    name: cString(1024),
    description: cString(4096),
    checksum_intermediate: uint32,
});

export const t_num_sources = uint32;
export const data_source_t = cStruct({
    cycle_interval: uint32,
    name: cString(128),
    type_name: cString(128),
})