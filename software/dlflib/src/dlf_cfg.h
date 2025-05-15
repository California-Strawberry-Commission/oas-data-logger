/**
 * How many ticks can be queued between samplers and writers
 * If logs are failing with QUEUE_FULL, this should be increased.
 *
 * Slow SD cards might need a larger queue
 */

#define DLF_SD_BLOCK_WRITE_SIZE 32
#define DLF_LOGFILE_BUFFER_SIZE DLF_SD_BLOCK_WRITE_SIZE * 10
#define DLF_FREERTOS_DURATION \
  chrono::duration<TickType_t, ratio<1, configTICK_RATE_HZ>>
#define LOCKFILE_NAME "LOCK"
#define UPLOAD_MARKER_FILE_NAME "UPLOADED"

// Comment out the following to remove debug messaging
// #define DEBUG Serial
