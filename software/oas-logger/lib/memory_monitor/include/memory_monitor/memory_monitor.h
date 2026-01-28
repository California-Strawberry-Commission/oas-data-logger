#pragma once

#include <AdvancedLogger.h>
#include <Arduino.h>
#include <esp_heap_caps.h>

namespace memory_monitor {

inline void logHeap(const char* tag) {
  // General purpose heap
  size_t total8Bit{heap_caps_get_total_size(MALLOC_CAP_8BIT)};
  size_t free8Bit{heap_caps_get_free_size(MALLOC_CAP_8BIT)};
  size_t min8Bit{heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT)};
  size_t largest8Bit{heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)};
  LOG_INFO("[%s] 8bit: total=%u, free=%u, min=%u, largest=%u\n", tag,
           (unsigned)total8Bit, (unsigned)free8Bit, (unsigned)min8Bit,
           (unsigned)largest8Bit);

  // Internal memory (on chip)
  size_t totalInternal{heap_caps_get_total_size(MALLOC_CAP_INTERNAL)};
  size_t freeInternal{heap_caps_get_free_size(MALLOC_CAP_INTERNAL)};
  size_t minInternal{heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL)};
  size_t largestInternal{heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)};
  LOG_INFO("[%s] internal: total=%u, free=%u, min=%u, largest=%u\n", tag,
           (unsigned)totalInternal, (unsigned)freeInternal,
           (unsigned)minInternal, (unsigned)largestInternal);

#if CONFIG_SPIRAM
  // External PSRAM
  size_t totalPsram{heap_caps_get_total_size(MALLOC_CAP_SPIRAM)};
  size_t freePsram{heap_caps_get_free_size(MALLOC_CAP_SPIRAM)};
  size_t minPsram{heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM)};
  size_t largestPsram{heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM)};
  LOG_INFO("[%s] psram: total=%u, free=%u, min=%u, largest=%u\n", tag,
           (unsigned)totalPsram, (unsigned)freePsram, (unsigned)minPsram,
           (unsigned)largestPsram);
#endif
}

}  // namespace memory_monitor