#include "dlflib/util/util.h"

namespace dlf::util {

UrlParts parseUrl(const char* url) {
  UrlParts urlParts;
  urlParts.scheme[0] = '\0';
  urlParts.host[0] = '\0';
  urlParts.path[0] = '\0';
  urlParts.port = 0;
  urlParts.ok = false;

  if (!url) {
    return urlParts;
  }

  const char* schemeSep = strstr(url, "://");
  if (!schemeSep) {
    // Invalid URL - no scheme
    return urlParts;
  }

  // Extract scheme
  if (!copyRange(urlParts.scheme, sizeof(urlParts.scheme), url, schemeSep)) {
    return urlParts;
  }

  const bool isHttps = (strcmp(urlParts.scheme, "https") == 0);
  const uint16_t defaultPort = isHttps ? 443 : 80;

  // Extract host
  const char* hostStart = schemeSep + 3;
  if (*hostStart == '\0') {
    // Invalid URL - no host
    return urlParts;
  }
  const char* pathStart = strchr(hostStart, '/');
  const char* hostEnd = pathStart ? pathStart : (hostStart + strlen(hostStart));

  const char* colon =
      static_cast<const char*>(memchr(hostStart, ':', hostEnd - hostStart));
  if (colon) {
    // host:port

    // Extract host
    if (!copyRange(urlParts.host, sizeof(urlParts.host), hostStart, colon)) {
      return urlParts;
    }

    // Extract port
    uint16_t port = 0;
    if (!parseU16(colon + 1, hostEnd, port)) {
      // Invalid URL - could not parse port
      return urlParts;
    }
    urlParts.port = port;
  } else {
    // host, no explicit port
    if (!copyRange(urlParts.host, sizeof(urlParts.host), hostStart, hostEnd)) {
      return urlParts;
    }
    urlParts.port = defaultPort;
  }

  // Extract path
  if (pathStart) {
    snprintf(urlParts.path, sizeof(urlParts.path), "%s", pathStart);
  } else {
    snprintf(urlParts.path, sizeof(urlParts.path), "/");
  }

  urlParts.ok = (urlParts.scheme[0] != '\0' && urlParts.host[0] != '\0');
  return urlParts;
}

}  // namespace dlf::util