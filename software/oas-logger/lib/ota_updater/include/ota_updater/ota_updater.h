#pragma once

#include <Arduino.h>
#include <dlflib/auth/request_signer.h>

namespace ota {

class OtaUpdater {
 public:
  struct Manifest {
    char deviceType[16]{0};
    char channel[16]{0};
    char version[32]{0};
    int buildNumber{-1};
    char sha256[65]{0};
    size_t size{0};  // bytes
  };

  struct Config {
    char manifestEndpoint[128]{
        "https://oas-data-logger.vercel.app/api/ota/manifest/%s/%s"};
    char firmwareEndpoint[128]{
        "https://oas-data-logger.vercel.app/api/ota/firmware/%s/%s/%d"};
    char deviceType[16]{"V1"};   // "V0" or "V1"
    char channel[16]{"STABLE"};  // "STABLE" or "BETA"
    int currentBuildNumber{-1};  // currently installed build number
    char deviceId[13]{0};
    char deviceSecret[65]{0};
    uint32_t manifestTimeoutMs{3000};
    uint32_t firmwareTimeoutMs{20000};
    uint32_t firmwareStallGraceMs{5000};
  };

  struct ManifestResult {
    bool ok{false};
    char message[128]{0};
    Manifest manifest{};
  };

  struct UpdateResult {
    bool ok{false};
    bool updateApplied{false};
    char message[128]{0};
    int newBuildNumber{-1};
  };

  explicit OtaUpdater(const Config& cfg);

  /**
   * Fetch the latest manifest.
   *
   * @return The resulting state of the manifest fetch process.
   */
  ManifestResult fetchLatestManifest();

  /**
   * Whether the manifest firmware version is newer than the one currently
   * installed.
   *
   * @param manifest The manifest data to check.
   * @return Whether the manifest firmware version is newer than the one
   * installed.
   */
  bool isUpdateAvailable(const Manifest& manifest) const;

  /**
   * Checks whether an update is available, and if it is, fetches the firmware
   * and flashes the device.
   *
   * @param rebootOnSuccess Whether the device should be restarted after a
   * successful update.
   * @return The resulting state of the update process.
   */
  UpdateResult updateIfAvailable(bool rebootOnSuccess = true);

 private:
  Config config_;
  dlf::auth::RequestSigner signer_;

  bool getManifestUrl(char* outUrl, size_t outUrlSize) const;
  bool getFirmwareUrl(int buildNumber, char* outUrl, size_t outUrlSize) const;
  UpdateResult downloadAndUpdate(const Manifest& manifest,
                                 bool rebootOnSuccess);
};

}  // namespace ota