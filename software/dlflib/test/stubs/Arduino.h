#pragma once
// Minimal Arduino stub for native (desktop) unit testing.
// Provides the standard types that dlflib headers pull in via <Arduino.h>.
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdio>
#include <memory>

using byte = uint8_t;

// FreeRTOS semaphore stubs (no-ops)
using SemaphoreHandle_t = void*;
#define portMAX_DELAY 0xFFFFFFFF
inline int xSemaphoreTake(SemaphoreHandle_t, uint32_t) { return 1; }
inline int xSemaphoreGive(SemaphoreHandle_t) { return 1; }
