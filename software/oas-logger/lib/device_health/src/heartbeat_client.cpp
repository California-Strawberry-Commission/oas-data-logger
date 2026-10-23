#include "heartbeat_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <dlflib/util/http.h>
#include <dlflib/util/util.h>
#include <esp_heap_caps.h>

#include "EzLog.h"
#include "reset_info.h"

namespace {

// RTC_NOINIT memory survives resets where the device stays powered (software
// resets, panics), but contents are garbage after power off then power on. The
// `magic` field is used to check that RTC_NOINIT memory is valid.
RTC_NOINIT_ATTR device_health::WifiDisconnectLog::Storage disconnectLogStorage;
RTC_NOINIT_ATTR device_health::FileWriteIssueLog::Storage
    fileWriteIssueLogStorage;

}  // namespace

namespace device_health {

HeartbeatClient::HeartbeatClient(const Config& cfg)
    : config_(cfg),
      signer_(cfg.deviceId, cfg.deviceSecret),
      sendMutex_(xSemaphoreCreateMutex()),
      disconnectLog_(disconnectLogStorage),
      fileWriteIssueLog_(fileWriteIssueLogStorage) {}

HeartbeatClient::~HeartbeatClient() {
  if (sendMutex_ != nullptr) {
    vSemaphoreDelete(sendMutex_);
  }
}

bool HeartbeatClient::begin() {
  if (sendMutex_ == nullptr || xTaskCreate(taskEntry, "heartbeat", 8192, this,
                                           1, &taskHandle_) != pdPASS) {
    return false;
  }

  WiFi.onEvent([this](WiFiEvent_t event, WiFiEventInfo_t info) {
    onWiFiEvent(event, info);
  });

  dlf::setFileWriteIssueHandler([this](const dlf::FileWriteIssue& issue) {
    recordFileWriteIssue(issue);
  });
  return true;
}

void HeartbeatClient::onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      // Wi-Fi connected. Send a heartbeat now.
      wifiConnected_ = true;
      if (taskHandle_ != nullptr) {
        xTaskNotifyGive(taskHandle_);
      }
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      // Wi-Fi disconnected. Also fired when a connection attempt fails.
      // Record a WifiDisconnectEvent.
      const uint8_t reason{info.wifi_sta_disconnected.reason};
      const int8_t rssi{info.wifi_sta_disconnected.rssi};
      EZLOG_INFO("[heartbeat] WiFi disconnected: reason=%u rssi=%d", reason,
                 rssi);
      const bool wasConnected{wifiConnected_};
      wifiConnected_ = false;
      const uint32_t now{millis()};
      const WifiDisconnectEvent e{
          resetInfo().bootCount, now, now, 1, reason, rssi, wasConnected,
      };
      portENTER_CRITICAL(&disconnectLogMux_);
      disconnectLog_.record(e);
      portEXIT_CRITICAL(&disconnectLogMux_);
      break;
    }
    default:
      break;
  }
}

void HeartbeatClient::recordFileWriteIssue(const dlf::FileWriteIssue& issue) {
  const FileWriteIssueEvent e{
      resetInfo().bootCount,
      issue.uptimeMs,
      issue.uptimeMs,
      issue.attempts,
      issue.durationMs,
      1,
      static_cast<uint8_t>(issue.type),
      static_cast<uint8_t>(issue.streamType),
  };
  portENTER_CRITICAL(&fileWriteIssueLogMux_);
  fileWriteIssueLog_.record(e);
  portEXIT_CRITICAL(&fileWriteIssueLogMux_);
}

bool HeartbeatClient::sendNow() {
  dlf::util::MutexLock lock{sendMutex_};
  return WiFi.status() == WL_CONNECTED && send();
}

void HeartbeatClient::taskEntry(void* arg) {
  static_cast<HeartbeatClient*>(arg)->run();
  vTaskDelete(nullptr);
}

void HeartbeatClient::run() {
  while (true) {
    sendNow();

    // Wait for the next interval, or until woken by a Wi-Fi connection
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(config_.intervalMs));
  }
}

bool HeartbeatClient::send() {
  const ResetInfo& reset{resetInfo()};

  // Disconnect events stay in the log until the heartbeat is acknowledged
  WifiDisconnectEvent disconnectEvents[WifiDisconnectLog::CAPACITY];
  portENTER_CRITICAL(&disconnectLogMux_);
  const size_t numDisconnectEvents{
      disconnectLog_.peek(disconnectEvents, WifiDisconnectLog::CAPACITY)};
  portEXIT_CRITICAL(&disconnectLogMux_);

  // File write issues stay in the log until acknowledged
  FileWriteIssueEvent fileWriteIssues[FileWriteIssueLog::CAPACITY];
  portENTER_CRITICAL(&fileWriteIssueLogMux_);
  const size_t numFileWriteIssues{
      fileWriteIssueLog_.peek(fileWriteIssues, FileWriteIssueLog::CAPACITY)};
  portEXIT_CRITICAL(&fileWriteIssueLogMux_);
  const bool includesCrash{reset.crash.present};

  // Build payload
  JsonDocument doc;
  doc["firmwareBuild"] = config_.firmwareBuild;
  doc["deviceType"] = config_.deviceType;
  doc["otaChannel"] = config_.otaChannel;
  doc["bootCount"] = reset.bootCount;
  doc["uptimeMs"] = millis();
  if (config_.state) {
    doc["state"] = config_.state();
  }

  JsonObject resetObj{doc["reset"].to<JsonObject>()};
  resetObj["reason"] = static_cast<int>(reset.reason);
  resetObj["appReason"] = static_cast<int>(reset.appReason);
  if (includesCrash) {
    JsonObject crash{resetObj["crash"].to<JsonObject>()};
    crash["bootCount"] = reset.crash.bootCount;
    crash["task"] = reset.crash.task;
    crash["pc"] = reset.crash.pc;
    crash["cause"] = reset.crash.cause;
    crash["vaddr"] = reset.crash.vaddr;
    JsonArray bt{crash["backtrace"].to<JsonArray>()};
    for (uint8_t i{0}; i < reset.crash.backtraceDepth; i++) {
      bt.add(reset.crash.backtrace[i]);
    }
    crash["btCorrupted"] = reset.crash.backtraceCorrupted;
    crash["elfSha256"] = reset.crash.elfSha256;
  }

  JsonObject heap{doc["heap"].to<JsonObject>()};
  heap["free"] = esp_get_free_heap_size();
  heap["minFree"] = esp_get_minimum_free_heap_size();
  heap["largestBlock"] = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);

  JsonObject wifi{doc["wifi"].to<JsonObject>()};
  wifi["rssi"] = WiFi.RSSI();
  JsonArray disconnectEventsArr{wifi["disconnectEvents"].to<JsonArray>()};
  for (size_t i{0}; i < numDisconnectEvents; i++) {
    const WifiDisconnectEvent& e{disconnectEvents[i]};
    JsonObject ev{disconnectEventsArr.add<JsonObject>()};
    ev["bootCount"] = e.bootCount;
    ev["uptimeMs"] = e.uptimeMs;
    ev["lastUptimeMs"] = e.lastUptimeMs;
    ev["count"] = e.count;
    ev["reason"] = e.reason;
    ev["rssi"] = e.rssi;
    ev["wasConnected"] = e.wasConnected;
  }

  JsonObject file{doc["file"].to<JsonObject>()};
  JsonArray writeIssuesArr{file["writeIssues"].to<JsonArray>()};
  for (size_t i{0}; i < numFileWriteIssues; i++) {
    const FileWriteIssueEvent& e{fileWriteIssues[i]};
    JsonObject ev{writeIssuesArr.add<JsonObject>()};
    ev["bootCount"] = e.bootCount;
    ev["uptimeMs"] = e.uptimeMs;
    ev["lastUptimeMs"] = e.lastUptimeMs;
    ev["count"] = e.count;
    ev["type"] = e.type;
    ev["streamType"] = e.streamType;
    ev["maxAttempts"] = e.maxAttempts;
    ev["maxDurationMs"] = e.maxDurationMs;
  }

  String body;
  serializeJson(doc, body);

  // Send request
  const bool useHttps{strncmp(config_.endpoint, "https", 5) == 0};
  auto wifiClient{dlf::util::createWiFiClient(useHttps, config_.caCert)};
  if (!wifiClient) {
    EZLOG_WARN("[heartbeat] Failed to create WiFi client");
    return false;
  }
  wifiClient->setTimeout(config_.timeoutMs / 1000);
  HTTPClient httpClient;
  dlf::util::HTTPClientGuard httpClientGuard{httpClient};
  httpClient.setTimeout(config_.timeoutMs);

  if (!httpClient.begin(*wifiClient, config_.endpoint)) {
    EZLOG_WARN("[heartbeat] HTTP begin failed");
    return false;
  }
  httpClient.addHeader("Content-Type", "application/json");
  if (!signer_.writeAuthHeaders(httpClient, body.c_str())) {
    EZLOG_WARN("[heartbeat] Failed to add auth headers");
    return false;
  }

  const int code{httpClient.POST(body)};
  if (code <= 0) {
    EZLOG_WARN("[heartbeat] POST failed: %s",
               httpClient.errorToString(code).c_str());
    return false;
  } else if (code < 200 || code >= 300) {
    EZLOG_WARN("[heartbeat] POST status: %d", code);
    return false;
  }
  EZLOG_DEBUG(
      "[heartbeat] Sent (%u Wi-Fi disconnect events, %u file write issues, "
      "crash=%d)",
      (unsigned)numDisconnectEvents, (unsigned)numFileWriteIssues,
      includesCrash);

  // Acknowledged. Clear the reported Wi-Fi disconnect events, file write
  // issues and crash.
  portENTER_CRITICAL(&disconnectLogMux_);
  disconnectLog_.discard(numDisconnectEvents);
  portEXIT_CRITICAL(&disconnectLogMux_);
  portENTER_CRITICAL(&fileWriteIssueLogMux_);
  fileWriteIssueLog_.discard(numFileWriteIssues);
  portEXIT_CRITICAL(&fileWriteIssueLogMux_);
  if (includesCrash) {
    clearCrash();
  }
  return true;
}

}  // namespace device_health
