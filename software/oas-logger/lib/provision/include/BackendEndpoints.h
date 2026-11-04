#pragma once

#include <cstddef>
#include <cstdio>
#include <cstring>

/**
 * BackendEndpoints.h
 *
 * PURPOSE:
 * Maps a backend environment name to the server the device talks to.
 *
 * A device is pinned to an environment ("prod" or "preview") during
 * provisioning and stays on it until it is reprovisioned. DeviceAuth stores
 * the name in NVS; the name -> base URL map lives here, compiled into the
 * firmware. Moving an environment to a new host is therefore a firmware
 * release, not a reprovision of every device.
 *
 * Each deployment is pinned to its own DATABASE_URL server-side, so choosing a
 * base URL transitively chooses the database.
 */
namespace backend_env {

struct Entry {
  const char* name;
  const char* baseUrl;
};

// The preview base URL is a copy of STAGING_ALIAS in
// .github/workflows/data-visualizer-deploy-staging.yml. Nothing syncs the two,
// so update this if that alias ever changes.
constexpr Entry ENVIRONMENTS[]{
    {"prod", "https://oas-data-logger.vercel.app"},
    {"preview", "https://oas-data-logger-staging.vercel.app"},
};

constexpr size_t ENVIRONMENT_COUNT{sizeof(ENVIRONMENTS) /
                                   sizeof(ENVIRONMENTS[0])};

constexpr const char* DEFAULT_ENV{"prod"};

// Endpoint paths. Placeholders are filled in by the components that issue
// the requests; never pass one of these as a format string.
constexpr const char* PATH_UPLOAD{"/api/upload/%s"};
constexpr const char* PATH_OTA_MANIFEST{"/api/ota/manifest/%s"};
constexpr const char* PATH_OTA_FIRMWARE{"/api/ota/firmware/%s/builds/%d"};
constexpr const char* PATH_HEARTBEAT{"/api/heartbeat"};

// Matches the smallest field a composed endpoint is later copied into:
// OtaUpdater::Config::manifestEndpoint and device_health::Config::endpoint are
// both char[128], so anything that fits here fits every consumer.
constexpr size_t ENDPOINT_BUF_LEN{128};

constexpr size_t ENV_BUF_LEN{16};

// Compile-time length maths, used only by the static_assert below.
//
// The firmware envs build at the Arduino toolchain default (gnu++11); only
// native-test sets -std=c++17. Single return recursion keeps these valid
// constexpr under both.
inline constexpr size_t cstrLen(const char* s, size_t off = 0) {
  return !s[off] ? off : cstrLen(s, off + 1);
}

inline constexpr size_t maxOf(size_t a, size_t b) { return a > b ? a : b; }

inline constexpr size_t maxBaseUrlLen(size_t i = 0) {
  return i >= ENVIRONMENT_COUNT
             ? 0
             : maxOf(cstrLen(ENVIRONMENTS[i].baseUrl), maxBaseUrlLen(i + 1));
}

inline constexpr size_t maxPathLen() {
  return maxOf(maxOf(cstrLen(PATH_UPLOAD), cstrLen(PATH_OTA_MANIFEST)),
               maxOf(cstrLen(PATH_OTA_FIRMWARE), cstrLen(PATH_HEARTBEAT)));
}

// Ensures an overly long URL fails the build here, rather than truncating
// silently on the later copy into Config::manifestEndpoint[128].
static_assert(maxBaseUrlLen() + maxPathLen() + 1 <= ENDPOINT_BUF_LEN,
              "A composed endpoint no longer fits ENDPOINT_BUF_LEN. Shorten "
              "the base URL, or widen this together with "
              "ota::OtaUpdater::Config and device_health::Config.");

/**
 * Looks up an environment's base URL.
 *
 * @param name Environment name, e.g. "prod". May be null.
 * @return The base URL, or nullptr if the name is not a known environment.
 */
inline const char* baseUrlFor(const char* name) {
  if (!name) {
    return nullptr;
  }

  for (size_t i = 0; i < ENVIRONMENT_COUNT; ++i) {
    if (strcmp(ENVIRONMENTS[i].name, name) == 0) {
      return ENVIRONMENTS[i].baseUrl;
    }
  }

  return nullptr;
}

/**
 * The set of backend endpoints for one environment.
 *
 * Accessors ending in Fmt return printf-style templates with unfilled
 * placeholders, not usable URLs.
 */
class BackendEndpoints {
 public:
  /**
   * Resolves envName to a base URL and composes every endpoint from it.
   *
   * envName is expected to already be valid, since DeviceAuth::loadEnv()
   * normalizes whatever NVS holds down to a known name. An unknown name here
   * is an error; it falls back to DEFAULT_ENV rather than leaving
   * the endpoints empty.
   */
  void resolve(const char* envName);

  const char* env() const { return env_; }

  const char* baseUrl() const { return baseUrl_; }

  const char* uploadEndpointFmt() const { return uploadEndpointFmt_; }
  const char* otaManifestEndpointFmt() const { return otaManifestEndpointFmt_; }
  const char* otaFirmwareEndpointFmt() const { return otaFirmwareEndpointFmt_; }

  const char* heartbeatEndpoint() const { return heartbeatEndpoint_; }

 private:
  char env_[ENV_BUF_LEN]{0};
  const char* baseUrl_{nullptr};
  char uploadEndpointFmt_[ENDPOINT_BUF_LEN]{0};
  char otaManifestEndpointFmt_[ENDPOINT_BUF_LEN]{0};
  char otaFirmwareEndpointFmt_[ENDPOINT_BUF_LEN]{0};
  char heartbeatEndpoint_[ENDPOINT_BUF_LEN]{0};
};

inline void BackendEndpoints::resolve(const char* envName) {
  const char* base = baseUrlFor(envName);

  if (!base) {
    envName = DEFAULT_ENV;
    base = baseUrlFor(DEFAULT_ENV);
  }

  snprintf(env_, sizeof(env_), "%s", envName);

  baseUrl_ = base;

  snprintf(uploadEndpointFmt_, sizeof(uploadEndpointFmt_), "%s%s", base,
           PATH_UPLOAD);
  snprintf(otaManifestEndpointFmt_, sizeof(otaManifestEndpointFmt_), "%s%s",
           base, PATH_OTA_MANIFEST);
  snprintf(otaFirmwareEndpointFmt_, sizeof(otaFirmwareEndpointFmt_), "%s%s",
           base, PATH_OTA_FIRMWARE);
  snprintf(heartbeatEndpoint_, sizeof(heartbeatEndpoint_), "%s%s", base,
           PATH_HEARTBEAT);
}

}  // namespace backend_env
