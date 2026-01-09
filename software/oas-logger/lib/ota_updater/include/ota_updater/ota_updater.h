#pragma once

#include <Arduino.h>

namespace ota {

struct Manifest {
  bool hasLatest = false;
  String deviceType;
  String channel;
  String version;
  int buildNumber = -1;
  String sha256;
  size_t size = 0;  // bytes
};

class OtaUpdater {
 public:
  struct Config {
    String manifestEndpoint =
        "https://oas-data-logger.vercel.app/api/ota/manifest/%s/%s";
    String firmwareEndpoint =
        "https://oas-data-logger.vercel.app/api/ota/firmware/%s/%s/%d";
    String deviceType;            // "V0" or "V1"
    String channel;               // "STABLE" or "BETA"
    int currentBuildNumber = -1;  // currently installed build number

    uint32_t httpTimeoutMs = 20000;
  };

  explicit OtaUpdater(Config cfg);

  /**
   * Fetch the latest manifest.
   *
   * @param out The latest manifest data.
   * @param err Error string, if the fetch was not successful.
   * @return Whether the fetch was successful.
   */
  bool fetchLatest(Manifest& out, String& err);

  /**
   * Whether the manifest firmware version is newer than the one currently
   * installed.
   *
   * @param manifest The manifest data to check.
   * @return Whether the manifest firmware version is newer than the one
   * installed.
   */
  bool isUpdateAvailable(const Manifest& manifest) const;

 private:
  Config config_;

  String getManifestUrl() const;
  String getFirmwareUrl(int buildNumber) const;
};

}  // namespace ota