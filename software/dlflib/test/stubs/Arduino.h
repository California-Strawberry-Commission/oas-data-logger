#pragma once
// Minimal Arduino stub for native (desktop) unit testing.
// Provides the standard types that dlflib headers pull in via <Arduino.h>.
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdio>
#include <memory>

using byte = uint8_t;
