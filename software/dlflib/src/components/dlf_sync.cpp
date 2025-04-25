#include "dlf_sync.h"

#include <HTTPClient.h>
#include <WiFi.h>

#include "../dlf_logger.h"
#include "dlf_cfg.h"
#include "dlf_wifi.h"

CSCDBSynchronizer::CSCDBSynchronizer(FS &fs, String fs_dir, size_t max_retries) : _fs(fs), dir(fs_dir), max_retries(max_retries) {
}

void CSCDBSynchronizer::syncTo(String server_ip, uint16_t port) {
    this->server_ip = server_ip;
    this->port = port;
}

bool CSCDBSynchronizer::begin() {
    Serial.println("Sync begin");
    xTaskCreate(task_sync, "sync", 4096, this, 5, NULL);

    return true;
}

// void run_needs_upload(String *run_name)
// {
//     HTTPClient http;
//     http.begin(serverPath.c_str());

//     int httpResponseCode = http.GET();
// }

// https://arduino.stackexchange.com/questions/93818/arduinohttpclient-post-multipart-form-data-from-sd-card-returning-400-bad-reques
bool CSCDBSynchronizer::upload_run(File run_dir, String path) {
    WiFiClient client;

    if (!run_dir) {
        Serial.println("No file.");
        return false;
    }

    // Try to init client
    for (int retries = 0; retries++ < 3 && !client.connect(server_ip.c_str(), port);) {
        Serial.println("Failed to connect. Retrying in 1s...");
        vTaskDelay(pdMS_TO_TICKS(1000));
    }

    if (!client.connected()) {
        Serial.println("Failed to connect. Terminating attempt.");
        return false;
    }

    // multipart boundary. Sent before each file.
    const char *boundary_template =
        "\r\n--boundary1\r\n"
        "Content-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n";

    // after this, post the file data.
    const char *closing_content = "\r\n--boundary1--\r\n";

    // Calculate overall message length
    // -2 to account for leading \r\n for initial boundary template actually being part of header
    size_t msg_length = strlen(closing_content) - 2;

    for (File f; f = run_dir.openNextFile();) {
        msg_length += snprintf(NULL, 0, boundary_template, f.name()) + f.size();
        f.close();
    }
    run_dir.rewindDirectory();

    // Send HTTP header
    client.printf(
        "POST %s HTTP/1.1\r\n"
        "Host: %s\r\n"
        "Content-Length: %ld\r\n"
        "Content-Type: multipart/form-data; boundary=boundary1\r\n",
        path.c_str(), server_ip, msg_length);

    // Send files
    const size_t chunk_size = 128;
    uint8_t buf[chunk_size];

    for (File f; f = run_dir.openNextFile();) {
        // Send boundary
        client.printf(boundary_template, f.name());

        // Send file data
        while (f.available()) {
            size_t num_read = f.read(buf, chunk_size);
            client.write(buf, num_read);
        }
        f.close();
    }
    client.print(closing_content);

    // Wait for response
    unsigned long timeout = millis();
    while (client.available() == 0) {
        if (millis() - timeout > 5000) {
            Serial.println(">>> Client RX Timeout !");
            client.stop();
            return false;
        }
    }
    client.stop();

    return true;
}

void CSCDBSynchronizer::task_sync(void *arg) {
    CSCDBSynchronizer *a = static_cast<CSCDBSynchronizer *>(arg);
    CSCWifiClient *c = a->get_component<CSCWifiClient>();
    CSCLogger *l = a->get_component<CSCLogger>();

    if (!l) {
        Serial.println("NO LOGGER??");
        vTaskDelete(NULL);
    }

    if (!c) {
        Serial.println("Cannot sync - no wifi client.");
        vTaskDelete(NULL);
    }

    while (true) {
        // Make sure SD is inserted and provided path is a dir
        File root = a->_fs.open(a->dir);
        if (!root) {
            Serial.println("No storage");
            vTaskDelay(pdMS_TO_TICKS(1000));
            vTaskDelete(NULL);
        }

        if (!root.isDirectory()) {
            Serial.println("Root is not dir - exiting sync");
            vTaskDelete(NULL);
        }

        // Wait for wifi to be connected
        xEventGroupWaitBits(
            c->ev,
            CSCWifiClient::WLAN_READY,
            pdFALSE,
            pdTRUE,
            portMAX_DELAY);

        Serial.println("wlan ready - Beginning sync");

        File run_dir;
        int num_failures = 0;
        while (xEventGroupGetBits(c->ev) & CSCWifiClient::WLAN_READY && (run_dir = root.openNextFile()) && num_failures < 3) {
            // Skip sys vol information file
            if (!strcmp(run_dir.name(), "System Volume Information"))
                continue;

            // Skip syncing in-progress run directories
            if (l->run_is_active(run_dir.name()))
                continue;

            Serial.printf("SYNC: %s\n", run_dir.name());

            // only sync run directories
            if (!run_dir.isDirectory())
                continue;

            String path = String("/upload/") + run_dir.name();
            num_failures += !a->upload_run(run_dir, path);
        }
        root.close();
        Serial.printf("Done syncing (failures: %d)\n", num_failures);

        xEventGroupWaitBits(
            l->ev,
            CSCLogger::NEW_RUN,
            pdTRUE,
            pdTRUE,
            portMAX_DELAY);
    }
}