#pragma once

#include <Arduino.h>
#include <FS.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "dlflib/auth/request_signer.h"
#include "dlflib/components/component.h"

namespace dlf::components {

// Chunk size used by uploadRunV2. Files are split into chunks of this size and
// uploaded individually, allowing uploads to be resumed after connection drops.
constexpr size_t UPLOAD_V2_CHUNK_SIZE = 256 * 1024;

// Progress file written to the run directory by uploadRunV2 to track which
// chunks have been successfully uploaded. Allows resuming after interruption.
constexpr const char* UPLOAD_V2_PROGRESS_FILE = ".uploadprog";

class UploaderComponent : public Component {
 public:
  enum class RetentionMode : uint8_t {
    KEEP,   // keep run data on SD card (no marker, no deletion)
    MARK,   // add upload marker file after successful upload
    DELETE  // delete run data after successful upload
  };

  struct Options {
    RetentionMode retentionMode = RetentionMode::MARK;
    // Secret used to sign upload requests. nullptr or empty string disables
    // signing.
    const char* secret = nullptr;
    // PEM-encoded CA certificate for HTTPS connections. If nullptr, certificate
    // validation is skipped (insecure).
    const char* caCert = nullptr;
    // Attempts to upload the active runs' data at a regular interval. <= 0
    // disables partial run uploads.
    int partialRunUploadIntervalSecs = 0;
    // Enable the new chunked upload path.
    bool enableUploadV2 = false;
  };

  /**
   * @param fs         Filesystem containing run directories (e.g. SD card).
   * @param fsDir      Root path under which run directories are stored.
   * @param endpointFmt printf-style format string for the upload endpoint URL,
   *                   with a single %s placeholder for the run UUID.
   *                   Example: "https://host/api/upload/%s"
   * @param deviceUid  Unique device identifier sent in auth headers.
   * @param options    Configuration options.
   */
  UploaderComponent(fs::FS& fs, const char* fsDir, const char* endpointFmt,
                    const char* deviceUid, const Options& options);

  bool begin() override;

  /**
   * Uploads all DLF files in a run directory as a single multipart/form-data
   * POST request.
   *
   * @param runDir   Open directory handle for the run to upload.
   * @param runUuid  UUID string identifying the run (used in the URL and auth).
   * @param isActive Whether the run is still actively being recorded.
   * @return true on success.
   */
  bool uploadRun(fs::File runDir, const char* runUuid, bool isActive = false);

  /**
   * Uploads all DLF files in a run directory using the resumable chunked
   * upload protocol. Files are split into chunks, each uploaded as a separate
   * POST.
   *
   * After all chunks are uploaded, a finalize request is sent to trigger
   * server-side reassembly and database record creation.
   *
   * @param runDir   Open directory handle for the run to upload.
   * @param runUuid  UUID string identifying the run (used in the URL and auth).
   * @param isActive Whether the run is still actively being recorded.
   * @return true if all chunks and the finalize request succeeded.
   */
  bool uploadRunV2(fs::File runDir, const char* runUuid, bool isActive = false);

  /**
   * Blocks until the background sync task has finished uploading all pending
   * completed runs.
   */
  void waitForSyncCompletion();

 private:
  enum WifiEvent {
    WLAN_READY = 1,
  };
  enum SyncEvent {
    SYNC_COMPLETE = 1,
  };

  static void syncTask(void* arg);
  static void partialRunUploadTask(void* arg);

  // https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/examples/WiFiClientEvents/WiFiClientEvents.ino
  void onWifiDisconnected(arduino_event_id_t event, arduino_event_info_t info);
  void onWifiConnected(arduino_event_id_t event, arduino_event_info_t info);
  WiFiClient* getWiFiClient(bool secure = true);
  WiFiClient* connectToEndpoint(const char* url, int maxRetries = 3,
                                uint32_t retryDelayMs = 500);
  bool deleteRunDir(fs::File runDir, const char* runDirPath);

  // v2 chunked upload helpers
  bool sendChunk(HTTPClient& http, const char* runUuid, uint32_t chunkNumber,
                 fs::File& file, size_t chunkBytes);
  bool sendFinalizeRequest(const char* finalizeUrl, const char* runUuid,
                           const char* const* filenames, size_t numFiles,
                           bool isActive);
  bool loadUploadProgress(const char* progressPath, uint32_t& metaChunk,
                          uint32_t& polledChunk, uint32_t& eventChunk);
  bool saveUploadProgress(const char* progressPath, uint32_t metaChunk,
                          uint32_t polledChunk, uint32_t eventChunk);

  std::unique_ptr<WiFiClient> wifiClient_;
  std::unique_ptr<WiFiClientSecure> wifiClientSecure_;
  dlf::auth::RequestSigner signer_;
  fs::FS& fs_;
  char fsDir_[128];
  char endpointFmt_[256];
  Options options_;
  // Used to notify when WiFi connected/disconnected
  EventGroupHandle_t wifiEvent_;
  // Used to notify when sync is in progress/complete
  EventGroupHandle_t syncEvent_;
};

}  // namespace dlf::components