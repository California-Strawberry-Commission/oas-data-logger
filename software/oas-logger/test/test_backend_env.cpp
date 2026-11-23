#include <gtest/gtest.h>

#include <cstring>

#include "BackendEndpoints.h"

using namespace backend_env;

namespace {

constexpr const char* PROD_BASE{"https://oas-data-logger.vercel.app"};
constexpr const char* PREVIEW_BASE{
    "https://oas-data-logger-staging.vercel.app"};

}  // namespace

// #region baseUrlFor

TEST(BaseUrlFor, KnownEnvironments) {
  EXPECT_STREQ(baseUrlFor("prod"), PROD_BASE);
  EXPECT_STREQ(baseUrlFor("preview"), PREVIEW_BASE);
}

TEST(BaseUrlFor, UnknownEnvironmentIsNull) {
  EXPECT_EQ(baseUrlFor("staging"), nullptr);
  EXPECT_EQ(baseUrlFor(""), nullptr);
  EXPECT_EQ(baseUrlFor(nullptr), nullptr);
}

TEST(BaseUrlFor, LocalIsAbsentWithoutBuildFlag) {
  EXPECT_EQ(baseUrlFor("local"), nullptr);

  BackendEndpoints endpoints;
  endpoints.resolve("local");
  EXPECT_STREQ(endpoints.env(), DEFAULT_ENV);
  EXPECT_STREQ(endpoints.baseUrl(), PROD_BASE);
}

TEST(BaseUrlFor, IsCaseSensitive) {
  EXPECT_EQ(baseUrlFor("Prod"), nullptr);
  EXPECT_EQ(baseUrlFor("PREVIEW"), nullptr);
}

// #endregion

// #region resolve

TEST(Resolve, Prod) {
  BackendEndpoints endpoints;
  endpoints.resolve("prod");

  EXPECT_STREQ(endpoints.env(), "prod");
  EXPECT_STREQ(endpoints.baseUrl(), PROD_BASE);
  EXPECT_STREQ(endpoints.uploadEndpointFmt(),
               "https://oas-data-logger.vercel.app/api/upload/%s");
  EXPECT_STREQ(endpoints.otaManifestEndpointFmt(),
               "https://oas-data-logger.vercel.app/api/ota/manifest/%s");
  EXPECT_STREQ(endpoints.otaFirmwareEndpointFmt(),
               "https://oas-data-logger.vercel.app/api/ota/firmware/%s/"
               "builds/%d");
  EXPECT_STREQ(endpoints.heartbeatEndpoint(),
               "https://oas-data-logger.vercel.app/api/heartbeat");
}

TEST(Resolve, Preview) {
  BackendEndpoints endpoints;
  endpoints.resolve("preview");

  EXPECT_STREQ(endpoints.env(), "preview");
  EXPECT_STREQ(endpoints.baseUrl(), PREVIEW_BASE);
  EXPECT_STREQ(endpoints.uploadEndpointFmt(),
               "https://oas-data-logger-staging.vercel.app/api/upload/%s");
  EXPECT_STREQ(
      endpoints.otaManifestEndpointFmt(),
      "https://oas-data-logger-staging.vercel.app/api/ota/manifest/%s");
  EXPECT_STREQ(endpoints.otaFirmwareEndpointFmt(),
               "https://oas-data-logger-staging.vercel.app/api/ota/firmware/"
               "%s/builds/%d");
  EXPECT_STREQ(endpoints.heartbeatEndpoint(),
               "https://oas-data-logger-staging.vercel.app/api/heartbeat");
}

TEST(Resolve, UnknownEnvironmentFallsBackToDefault) {
  BackendEndpoints endpoints;
  endpoints.resolve("staging");

  EXPECT_STREQ(endpoints.env(), DEFAULT_ENV);
  EXPECT_STREQ(endpoints.baseUrl(), PROD_BASE);
}

TEST(Resolve, EmptyAndNullFallBackToDefault) {
  BackendEndpoints empty;
  empty.resolve("");
  EXPECT_STREQ(empty.env(), DEFAULT_ENV);

  BackendEndpoints none;
  none.resolve(nullptr);
  EXPECT_STREQ(none.env(), DEFAULT_ENV);
  EXPECT_STREQ(none.baseUrl(), PROD_BASE);
}

TEST(Resolve, OverwritesPreviousEnvironment) {
  BackendEndpoints endpoints;
  endpoints.resolve("preview");
  endpoints.resolve("prod");

  EXPECT_STREQ(endpoints.env(), "prod");
  EXPECT_STREQ(endpoints.baseUrl(), PROD_BASE);
  EXPECT_EQ(strstr(endpoints.uploadEndpointFmt(), "staging"), nullptr);
  EXPECT_EQ(strstr(endpoints.otaManifestEndpointFmt(), "staging"), nullptr);
  EXPECT_EQ(strstr(endpoints.otaFirmwareEndpointFmt(), "staging"), nullptr);
  EXPECT_EQ(strstr(endpoints.heartbeatEndpoint(), "staging"), nullptr);
}

// #endregion